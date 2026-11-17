import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { loadPlaytestEngine } from "./playtestEngine.js";
import { runPlaytest, withoutSeeds, playerFacts, observationChanges, boundedHistory } from "./playtestRunner.js";
import { modelSettings, parseAgentReply, reflectionFields, buildMoveInstructions, moveInstructions } from "./playerAgent.js";
import { toggleOption } from "./playtest.js";
import { ensureProject, createVersion, setVersionStatus, playtestsDirectory } from "./gameStorage.js";

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const feedback = Object.fromEntries(reflectionFields.map((key) => [key, `My ${key} from this game.`]));
const gameCode = (overrides = "") => `window.GameEngine = {
  name: 'Hidden race', players: 3, minPlayers: 1, maxPlayers: 3, hidden: true,
  rules: 'Reach four; player 3 is eliminated and does not move.',
  initialState(n) { return { n, total: 0, seed: 934671, hands: ['secret-one','secret-two','secret-three'], deck: ['secret-deck'] }; },
  currentPlayer(s) { return s.total < 2 ? 1 : 2; },
  legalMoves(s) { return this.result(s) ? [] : [{ add: 1 }]; },
  applyMove(s,m) { return { ...s, total: s.total + m.add }; },
  result(s) { return s.total >= 4 ? { winners: [1, 2], scores: [4, 4, 0] } : null; },
  observe(s,p) { return { ...s, hands: s.hands.map((h,i) => i === p-1 ? h : null), deck: [null], seed: 0 }; },
  describeMove() { return 'Advanced by one'; },
  agentContext() { return { summary: 'A race along a track from zero to four. No spatial map.', target: 4 }; },
  agentObservation(s, player) { return { self: { player, name: 'Runner ' + player, hand: s.hands[player-1] },
    total: s.total, metrics: { 'Track progress': s.total } }; },
  describeAction(s, move, player) { return { label: 'Advance by ' + move.add + ' to ' + (s.total + move.add), category: 'Advance' }; },
  ${overrides}
};`;

async function setup(t, code = gameCode()) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "llm-playtest-"));
  const file = path.join(dir, "game.js");
  await fs.writeFile(file, code);
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const engine = await loadPlaytestEngine(file, { timeoutMs: 250 });
  t.after(() => engine.close());
  return { dir, file, engine, outDir: path.join(dir, "match"), rules: engine.info.rules };
}

function goodAgent() {
  return { async respond(kind, input) {
    return { raw: JSON.stringify(kind === "move" ? { feeling: `Private thought of player ${input.player}`,
      reason: `I can advance at decision ${input.matchDecisionNumber}.`, moveId: input.legalMoves[0].id } : feedback),
    usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } };
  } };
}

test("complete match: private agents, consecutive turns, eliminated player reflection, replay and report", async (t) => {
  const setupResult = await setup(t);
  const requests = [], seats = [], events = [];
  const result = await runPlaytest({ ...setupResult, agentFactory(player) {
    seats.push(player);
    return { async respond(kind, input, options) {
      requests.push({ player, kind, input });
      const serialized = JSON.stringify(input);
      assert.equal(input.player, player);
      assert.doesNotMatch(serialized, /"seed"|934671|secret-deck/);
      for (const other of [1, 2, 3].filter((p) => p !== player)) {
        assert.ok(!serialized.includes(`secret-${["one", "two", "three"][other - 1]}`));
        assert.ok(!serialized.includes(`Private thought of player ${other}`));
      }
      return goodAgent().respond(kind, input, options);
    } };
  }, onEvent: (event) => events.push(event) });
  assert.deepEqual(seats, [1, 2, 3]);
  assert.equal(result.metadata.status, "complete");
  assert.equal(result.metadata.feedbackStatus, "complete");
  assert.deepEqual(result.moves.map((m) => m.player), [1, 1, 2, 2]);
  assert.deepEqual(requests.filter((r) => r.kind === "reflection").map((r) => r.player), [1, 2, 3]);
  assert.ok(requests.filter(r => r.kind === "move").every(r => !Object.hasOwn(r.input, "subjectiveCommentary")));
  assert.deepEqual(requests[1].input.availableActionCounts, { Advance: 1 });
  assert.ok(!JSON.stringify(requests[1].input.factualHistory).includes("Private thought"));
  assert.equal(requests.find((r) => r.kind === "reflection" && r.player === 1).input.subjectiveCommentary.events.length, 2);
  const finalInput = requests.find((r) => r.kind === "reflection" && r.player === 1).input;
  assert.equal(finalInput.recordedFacts.yourDecisionCount, 2);
  assert.equal(finalInput.recordedFacts.matchDecisionCount, 4);
  assert.equal(finalInput.recordedFacts.outcome, "shared win");
  assert.deepEqual(finalInput.recordedFacts.actionCounts, { Advance: 2 });
  assert.equal(finalInput.recordedFacts.gameMetrics["Track progress"], 4);
  assert.equal(finalInput.decisions, undefined);
  assert.equal(requests[0].input.legalMoves[0].label, "Advance by 1 to 1");
  assert.equal(requests[0].input.legalMoves[0].move, undefined);
  assert.equal(requests[0].input.gameContext.target, 4);
  assert.equal(result.metadata.usage.totalTokens, 210);
  let state = result.replay.initialState;
  for (const { move } of result.replay.moves) state = setupResult.engine.call("applyMove", state, move);
  assert.deepEqual(state, result.replay.finalState);
  const report = await fs.readFile(path.join(setupResult.outDir, "report.md"), "utf8");
  assert.match(report, /Player 3/);
  assert.match(report, /Decision 4/);
  assert.match(report, /My improvements/);
  assert.match(report, /Personal decisions: \*\*2\*\*\. Match decisions: \*\*4\*\*/);
  assert.ok(report.indexOf("Selected action: Advance") < report.indexOf("Agent feeling (subjective)"));
  const transcript = (await fs.readFile(path.join(setupResult.outDir, "transcript.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(transcript, events);
  assert.equal(transcript.at(-1).type, "run_finished");
  assert.deepEqual(transcript.map((event) => event.sequence), transcript.map((_, i) => i + 1));
});

test("invalid model moves retry without changing state; correction uses the same decision", async (t) => {
  const config = await setup(t);
  let calls = 0;
  const result = await runPlaytest({ ...config, agentFactory: () => ({ async respond(kind, input, options) {
    if (kind === "move" && ++calls === 1) return { raw: '{"feeling":"fine","reason":"try","moveId":"invented"}' };
    if (calls === 2 && kind === "move") {
      assert.equal(input.matchDecisionNumber, 1);
      assert.equal(input.observation.total, 0);
      assert.match(options.correction, /moveId/);
    }
    return goodAgent().respond(kind, input);
  } }) });
  assert.equal(result.metadata.status, "complete");
  assert.equal(calls, 5);
  assert.equal(result.moves.length, 4);
  assert.equal(result.metadata.diagnostics.failedAttempts, 1);
  assert.equal(result.metadata.diagnostics.recoveredAttempts, 1);
  assert.equal(result.metadata.diagnostics.retryRequests, 1);
  assert.equal(result.metadata.diagnostics.errors[0].code, "illegal_move_id");
  const events = (await fs.readFile(path.join(config.outDir, "transcript.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  const rejected = events.find(e => e.type === "agent_error");
  assert.equal(JSON.parse(rejected.rawResponse).moveId, "invented");
  assert.equal(rejected.decision, 1);
  assert.equal(rejected.requestId, 1);
  assert.match(await fs.readFile(path.join(config.outDir, "report.md"), "utf8"), /illegalMoves|supplied legalMoves/);
});

test("exhausted retries save an incomplete run and collect reflections without random fallback", async (t) => {
  const config = await setup(t);
  let calls = 0;
  const result = await runPlaytest({ ...config, retries: 1, agentFactory: () => ({ async respond(kind, input) {
    if (kind === "move") { calls++; return { raw: "not json" }; }
    assert.equal(input.status, "incomplete");
    return goodAgent().respond(kind, input);
  } }) });
  assert.equal(calls, 2);
  assert.equal(result.metadata.status, "incomplete");
  assert.equal(result.moves.length, 0);
  assert.equal(result.reflections.length, 3);
  assert.equal(result.metadata.diagnostics.failedAttempts, 2);
  assert.equal(result.metadata.diagnostics.unrecoveredAttempts, 2);
  assert.equal(result.metadata.diagnostics.errors[0].code, "invalid_json");
  assert.match(await fs.readFile(path.join(config.outDir, "report.md"), "utf8"), /incomplete/);
});

test("move budget preserves played moves and labels the match incomplete", async (t) => {
  const result = await runPlaytest({ ...await setup(t), maxMoves: 2, agentFactory: goodAgent });
  assert.equal(result.moves.length, 2);
  assert.equal(result.metadata.status, "incomplete");
  assert.match(result.metadata.reason, /Move limit/);
  assert.equal(result.replay.finalState.total, 2);
});

test("timeouts are bounded even when a provider ignores the abort signal", async (t) => {
  const result = await runPlaytest({ ...await setup(t), timeoutMs: 15, retries: 0,
    agentFactory: () => ({ respond: () => new Promise(() => {}) }) });
  assert.equal(result.metadata.status, "incomplete");
  assert.match(result.metadata.reason, /timed out/);
  assert.equal(result.metadata.feedbackStatus, "partial");
  assert.equal(result.metadata.usage.requestsWithoutUsage, result.metadata.usage.requests);
  assert.equal(result.metadata.diagnostics.failedUsage.attemptsWithoutUsage, 4);
  assert.equal(result.metadata.diagnostics.errors[0].rawResponseRecorded, false);
  assert.equal(result.metadata.diagnostics.errors[0].stage, "request");
});

test("interruption after a move persists progress and makes no additional model requests", async (t) => {
  const controller = new AbortController();
  const result = await runPlaytest({ ...await setup(t), signal: controller.signal, agentFactory: goodAgent,
    onEvent(event) { if (event.type === "move_accepted") controller.abort(new Error("User interrupted")); } });
  assert.equal(result.moves.length, 1);
  assert.equal(result.metadata.usage.requests, 1);
  assert.equal(result.metadata.status, "incomplete");
  assert.equal(result.metadata.feedbackStatus, "partial");
});

test("draw at the final permitted move is complete and reflection failures do not change the outcome", async (t) => {
  const config = await setup(t, gameCode("result(s) { return s.total >= 1 ? { winner: null } : null; }"));
  const result = await runPlaytest({ ...config, maxMoves: 1, retries: 0, agentFactory: () => ({ async respond(kind, input) {
    if (kind === "reflection" && input.player === 2) throw new Error("Provider failed");
    return goodAgent().respond(kind, input);
  } }) });
  assert.equal(result.metadata.status, "complete");
  assert.deepEqual(result.metadata.result, { winner: null });
  assert.equal(result.metadata.feedbackStatus, "partial");
  assert.ok(result.reflections[2].feedback);
  assert.equal(result.metadata.diagnostics.errors[0].kind, "reflection");
  assert.equal(result.metadata.diagnostics.errors[0].decision, null);
  assert.equal(result.metadata.diagnostics.unrecoveredAttempts, 1);
});

test("engine calls enforce timeouts, immutability, and hidden observation requirements", async (t) => {
  const { engine } = await setup(t, gameCode("applyMove(s,m) { s.total++; return s; }, legalMoves() { while (true) {} }"));
  const state = engine.call("initialState", 3);
  assert.throws(() => engine.call("applyMove", state, 1), /mutated/);
  assert.throws(() => engine.call("legalMoves", state), /timed out/);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bad-engine-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "game.js");
  await fs.writeFile(file, gameCode("observe: null"));
  await assert.rejects(loadPlaytestEngine(file), /require observe/);
});

test("oversized prompts fail before a model call instead of silently removing current state", async (t) => {
  let calls = 0;
  const result = await runPlaytest({ ...await setup(t), maxPromptChars: 10,
    agentFactory: () => ({ respond() { calls++; throw new Error("unexpected"); } }) });
  assert.equal(calls, 0);
  assert.match(result.metadata.reason, /maxPromptChars/);
});

test("model settings keep generation model separate and reply parser rejects missing commentary", () => {
  assert.deepEqual(withoutSeeds({ seed: 1, nested: { rng_seed: 2, randomSeed: 3, birdseed: 4, seeds: 5 } }), { nested: { birdseed: 4, seeds: 5 } });
  const kimi = modelSettings({ BAYLEAF_API_KEY: "test", MODEL: "generation-model" });
  assert.equal(kimi.model, "openrouter:moonshotai/kimi-k3.1-pro");
  assert.deepEqual(kimi.reasoning, { effort: "low" });
  assert.deepEqual(kimi.outputTokenLimits, { move: 8192, reflection: 8192 });
  const custom = modelSettings({ BAYLEAF_API_KEY: "test", PLAYTEST_MODEL: "custom" });
  assert.equal(custom.model, "custom");
  assert.equal(custom.reasoning, null);
  assert.equal(modelSettings({ BAYLEAF_API_KEY: "test", PLAYTEST_MODEL: "custom" }, { model: "cli" }).model, "cli");
  assert.equal(modelSettings({ GEMINI_API_KEY: "test" }).model, "gemini-3.5-flash-lite");
  assert.equal(modelSettings({ GEMINI_API_KEY: "test", PLAYTEST_MODEL: "custom" }).model, "custom");
  assert.throws(() => parseAgentReply('{"moveId":"m1"}', "move", [{ id: "m1" }]), /feeling/);
  assert.throws(() => modelSettings({}), /GEMINI_API_KEY/);
});

test("personal counts are calculated independently of the 124-decision match total", () => {
  const moves = [36, 36, 16, 36].flatMap((n, i) => Array.from({ length: n }, () => ({ player: i + 1, action: { category: "Travel" } })));
  const facts = playerFacts(1, moves, { winner: 4, scores: [0, 0, 0, 6] }, { metrics: { "Orders filled": 0 } }, "complete");
  assert.equal(facts.yourDecisionCount, 36);
  assert.equal(facts.matchDecisionCount, 124);
  assert.equal(facts.finalScore, 0);
  assert.equal(facts.outcome, "lost");
  assert.deepEqual(facts.gameMetrics, { "Orders filled": 0 });
});

test("memory stores compact factual changes instead of old board snapshots", () => {
  const board = Array.from({ length: 100 }, () => "pasture");
  const before = { self: { player: 1, name: "Sheep", position: "Pasture (6,16)" }, board };
  const after = { self: { player: 1, name: "Sheep", position: "Pasture (6,15)" }, board };
  const change = observationChanges(before, after);
  assert.deepEqual(change.changes, [{ field: "self.position", before: "Pasture (6,16)", after: "Pasture (6,15)" }]);
  assert.ok(JSON.stringify(change).length < JSON.stringify(before).length / 2);
  const history = Array.from({ length: 200 }, (_, decision) => ({ decision, ...change }));
  const bounded = boundedHistory(history, 3000);
  assert.ok(bounded.omittedEarlierEvents > 0);
  assert.equal(bounded.events.at(-1).decision, 199);
  assert.ok(bounded.events.reduce((n, event) => n + JSON.stringify(event).length, 0) <= 3000);
});

test("inaccurate subjective explanations trigger no extra review calls and never enter facts", async (t) => {
  let calls = 0;
  const inputs = [];
  const result = await runPlaytest({ ...await setup(t), agentFactory: () => ({ async respond(kind, input) {
    calls++; inputs.push({ kind, input });
    if (kind === "move") return { raw: { moveId: input.legalMoves[0].id, feeling: "Confident", reason: "I filled a Sampler for nine points." } };
    return { raw: feedback };
  } }) });
  assert.equal(calls, 7); // four actual decisions, three reflections; zero evaluator requests
  assert.equal(result.metadata.status, "complete");
  for (const { kind, input } of inputs) {
    assert.ok(!JSON.stringify(input.recordedFacts).includes("Sampler"));
    assert.ok(!JSON.stringify(input.factualHistory).includes("Sampler"));
    if (kind === "move") {
      assert.ok(!JSON.stringify(input).includes("Sampler"));
      assert.equal(Object.hasOwn(input, "subjectiveCommentary"), false);
      assert.equal(input.observation.total, input.matchDecisionNumber - 1);
      assert.deepEqual(input.availableActionCounts, { Advance: input.legalMoves.length });
    }
  }
  assert.ok(inputs.some(({ kind, input }) => kind === "reflection" && JSON.stringify(input.subjectiveCommentary).includes("Sampler")));
  assert.equal(result.moves[0].reason, "I filled a Sampler for nine points.");
  assert.equal(result.moves[0].action.label, "Advance by 1 to 1");
});

test("legacy games without readable context are rejected before a playtest begins", async (t) => {
  const { file } = await setup(t);
  await fs.writeFile(file, gameCode().replace("agentContext()", "oldContext()"));
  await assert.rejects(loadPlaytestEngine(file), /Missing agent interface.*Generate a new game/);
});

test("planning and endgame guidance toggle independently; private plans replace, abandon, and survive retries", async t => {
  const planFor = p => ({ goal: `Goal-p${p}`, steps: ["Advance on my next opportunity"], reconsiderIf: "The current state changes", horizon: "Unknown; depends on when the counter reaches four" });
  for (const planning of [false, true]) for (const endgameAwareness of [false, true]) {
    const endgame = { endingConditions: "Counter reaches four.", remaining: "Unknown: depends on moves.", scoring: "Players 1 and 2 share victory at four.", tiebreakers: "Shared victory.", uncertainty: "No fixed round limit." };
    const overrides = planning && endgameAwareness ? `agentObservation(s,player) {return {self:{player,name:'Runner '+player},metrics:{total:s.total},endgame:${JSON.stringify(endgame)}}},` : "";
    const config = await setup(t, gameCode(overrides));
    const requests = []; let retried = false;
    const result = await runPlaytest({ ...config, planning, endgameAwareness, agentFactory: () => ({ async respond(kind, input) {
      requests.push({ kind, input: structuredClone(input) });
      if (kind === "reflection") return { raw: feedback };
      if (planning) {
        assert.equal(input.previousPlan?.plan.goal ?? null, [2, 4].includes(input.matchDecisionNumber) ? `Goal-p${input.player}` : null);
        assert.ok(!JSON.stringify(input).includes(`Goal-p${input.player === 1 ? 2 : 1}`));
      } else assert.equal(Object.hasOwn(input, "previousPlan"), false);
      assert.equal(Object.hasOwn(input, "endgameGuidance"), endgameAwareness);
      if (endgameAwareness) assert.deepEqual(input.endgameGuidance.facts, planning ? endgame : null);
      const raw = { feeling: "Focused", reason: "Advance", moveId: input.legalMoves[0].id };
      if (planning) raw.plan = input.matchDecisionNumber === 2 ? null : planFor(input.player);
      if (planning && input.matchDecisionNumber === 2 && !retried) { retried = true; raw.plan = { goal: "Invalid replacement" }; }
      return { raw };
    } }) });
    assert.equal(result.metadata.status, "complete");
    assert.deepEqual(result.metadata.agentOptions, { planning, endgameAwareness });
    assert.equal(requests.length, planning ? 8 : 7); // no planning/review model calls
    for (const { input } of requests) assert.ok(!JSON.stringify(input.factualHistory).includes("Goal-p"));
    if (planning) {
      const reflection = p => requests.find(r => r.kind === "reflection" && r.input.player === p).input;
      assert.equal(reflection(1).lastPlan, null);
      assert.equal(reflection(2).lastPlan.decision, 4);
      assert.equal(reflection(3).lastPlan, null);
      assert.equal(result.moves[1].previousPlan.decision, 1);
      assert.equal(result.moves[1].plan, null);
      const report = await fs.readFile(path.join(config.outDir, "report.md"), "utf8");
      assert.match(report, /Updated tentative plan/);
    } else assert.ok(result.moves.every(m => !Object.hasOwn(m, "plan")));
  }
});

test("feature prompts and bounded plans preserve the baseline when disabled", () => {
  assert.equal(buildMoveInstructions(), moveInstructions);
  assert.match(buildMoveInstructions({ planning: true }), /"plan":/);
  assert.doesNotMatch(buildMoveInstructions({ endgameAwareness: true }), /"plan":/);
  assert.match(buildMoveInstructions({ endgameAwareness: true }), /tiebreakers/);
  const reply = { feeling: "Fine", reason: "Pass", moveId: "m1" };
  assert.throws(() => parseAgentReply(reply, "move", [{ id: "m1" }], { planning: true }), /plan is missing/);
  assert.equal(parseAgentReply({ ...reply, plan: null }, "move", [{ id: "m1" }], { planning: true }).plan, null);
  assert.throws(() => parseAgentReply({ ...reply, plan: { goal: "g", steps: ["s".repeat(161)], reconsiderIf: "r", horizon: "unknown" } }, "move", [{ id: "m1" }], { planning: true }), /plan.steps/);
  assert.equal(Object.hasOwn(parseAgentReply({ ...reply, plan: "ignored when off" }, "move", [{ id: "m1" }]), "plan"), false);
  assert.equal(toggleOption("on", "planning"), true);
  assert.equal(toggleOption("off", "planning"), false);
  assert.equal(toggleOption(undefined, "planning"), false);
  assert.throws(() => toggleOption("maybe", "planning"), /must be on or off/);
});

for (const [features, kimi] of [[false, false], [true, false], [false, true]]) test(`CLI uses local mock, caps and artifacts with features ${features ? "on" : "off"}, Kimi ${kimi}`, async (t) => {
  const { dir, file } = await setup(t);
  let gameReference = file, outputParent = path.join(dir, "cli-runs");
  if (features) {
    gameReference = await ensureProject("Mock Game", path.join(dir, "library"));
    const versionDir = await createVersion(gameReference);
    await fs.copyFile(file, path.join(versionDir, "game.js"));
    await setVersionStatus(versionDir, "validated");
    outputParent = await playtestsDirectory(versionDir);
  }
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    requests.push(request);
    const input = JSON.parse(request.messages[1].content);
    const raw = input.legalMoves ? { feeling: "Hopeful", reason: "I can advance.", moveId: input.legalMoves[0].id } : feedback;
    if (input.legalMoves && features) raw.plan = { goal: "Advance", steps: ["Advance again if possible"], reconsiderIf: "The game ends", horizon: "Unknown" };
    if (requests.length === 1) delete raw.moveId;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ id: "mock", object: "chat.completion", created: 0, model: "mock-player",
      choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(raw) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const result = await promisify(execFile)(process.execPath, [path.join(projectDir, "playtest.js"), gameReference,
    "--provider", "bayleaf", ...(features ? ["--version", "latest"] : ["--out", outputParent]),
    ...(kimi ? [] : ["--model", "mock-player", "--move-tokens", "210", "--reflection-tokens", "900"]),
    ...(features ? ["--planning", "on", "--endgame-awareness", "on"] : [])],
  { timeout: 20_000, env: { ...process.env, PLAYTEST_MODEL: "", BAYLEAF_API_KEY: "test-key", PLAYTEST_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` } });
  assert.match(result.stdout, /Game complete/);
  assert.equal(requests.length, 8);
  assert.ok(requests.slice(0, 5).every((request) => request.max_tokens === (kimi ? 8192 : 210)));
  assert.ok(requests.slice(5).every((request) => request.max_tokens === (kimi ? 8192 : 900)));
  for (const request of requests) {
    assert.equal(request.model, kimi ? "openrouter:moonshotai/kimi-k3.1-pro" : "mock-player");
    assert.deepEqual(request.reasoning, kimi ? { effort: "low" } : undefined);
  }
  const [match] = await fs.readdir(outputParent);
  assert.equal(match, "run-001");
  const out = path.join(outputParent, match);
  for (const file of ["report.md", "metadata.json", "transcript.jsonl", "replay.json", "replay.html", "agent-context.json", "game.js", "rules.md"]) await fs.access(path.join(out, file));
  const metadata = JSON.parse(await fs.readFile(path.join(out, "metadata.json"), "utf8"));
  assert.equal(metadata.usage.totalTokens, 240);
  assert.deepEqual(metadata.reasoning, kimi ? { effort: "low" } : null);
  assert.deepEqual(metadata.agentOptions, { planning: features, endgameAwareness: features });
  for (const request of requests.slice(0, 5)) {
    const input = JSON.parse(request.messages[1].content);
    assert.equal(Object.hasOwn(input, "previousPlan"), features);
    assert.equal(Object.hasOwn(input, "endgameGuidance"), features);
    assert.equal(request.messages[0].content.includes('"plan":'), features);
  }
  assert.equal(metadata.diagnostics.failedUsage.totalTokens, 30);
  assert.equal(metadata.diagnostics.errors[0].finishReason, "stop");
  assert.equal(metadata.diagnostics.errors[0].error, "moveId is missing");
  const transcript = (await fs.readFile(path.join(out, "transcript.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  const rejected = JSON.parse(transcript.find(e => e.type === "agent_error").rawResponse);
  assert.equal(rejected.feeling, "Hopeful");
  assert.equal(Object.hasOwn(rejected, "moveId"), false);
  assert.equal(Object.hasOwn(rejected, "plan"), features);
  assert.equal(metadata.feedbackStatus, "complete");
  assert.equal(metadata.gameSha256.length, 64);
  assert.ok(!JSON.stringify(metadata).includes("test-key"));
});
