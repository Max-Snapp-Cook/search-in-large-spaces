import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { improveGame, loadImprovementInputs, parseImprovementPlan, loadSavedImprovement } from "./improveRunner.js";
import { improvementModelSettings } from "./improve.js";
import { ensureProject, createVersion, setVersionStatus, playtestsDirectory } from "./gameStorage.js";

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const passed = { ok: true, stage: "complete", errors: [] };
const failed = { ok: false, stage: "playout", errors: ["Broken observation"] };
const planFor = rules => ({ summary: "Clarify current resources; this partial run cannot establish balance.", changes: [{ id: "C1", title: "Clarify resources",
  kind: "agent-interface", evidence: [{ report: "report-1", detail: "Decision 2 confuses resources; agentObservation has an ambiguous label." }],
  implementation: "Name the inventory fields in agentObservation", changesRules: false, verification: "Observe player 1 and verify named inventory." }],
  deferred: ["Timeout is a provider/run issue, not a game bug."], rulesMarkdown: rules });

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "game-improve-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const code = await fs.readFile(new URL("./fixtures/connect-four.js", import.meta.url), "utf8");
  const rules = "Connect four discs to win. Full board without a winner is a draw.\n";
  await fs.writeFile(path.join(dir, "game.js"), code);
  await fs.writeFile(path.join(dir, "rules.md"), rules);
  const match = path.join(dir, "playtests", "match-1");
  await fs.mkdir(match, { recursive: true });
  await fs.writeFile(path.join(match, "report.md"), "# Report\nIncomplete. Decision 2: player confused about inventory. Request timed out.");
  await fs.writeFile(path.join(match, "metadata.json"), JSON.stringify({ status: "incomplete", gameSha256: createHash("sha256").update(code).digest("hex") }));
  return { dir, code, rules, match };
}

test("discovers matching reports, skips other versions, deduplicates, and labels missing provenance", async t => {
  const { dir, match } = await fixture(t);
  const other = path.join(dir, "playtests", "other"); await fs.mkdir(other);
  await fs.writeFile(path.join(other, "report.md"), "Other game report");
  await fs.writeFile(path.join(other, "game.js"), "different source");
  const input = await loadImprovementInputs(dir);
  assert.equal(input.reports.length, 1);
  assert.equal(input.reports[0].run.status, "incomplete");
  assert.equal(input.skipped.length, 1);
  await assert.rejects(loadImprovementInputs(dir, [other]), /different game version/);
  assert.equal((await loadImprovementInputs(dir, [match, path.join(match, "report.md")])).reports.length, 1);
  const looseDir = path.join(dir, "loose"); await fs.mkdir(looseDir);
  const loose = path.join(looseDir, "report.md"); await fs.writeFile(loose, "Unverified standalone feedback");
  assert.equal((await loadImprovementInputs(dir, [loose])).reports[0].provenance, "unverified-no-source-hash");
  await assert.rejects(loadImprovementInputs(dir, [path.join(dir, "missing.md")]), /ENOENT/);
});

test("implements and repairs in a new directory with saved plan, evidence, revised rules, and source preservation", async t => {
  const f = await fixture(t), plan = planFor(f.rules), stages = [];
  plan.changes[0].changesRules = true; plan.rulesMarkdown = f.rules + "Revised scoring rule for this test.\n";
  const result = await improveGame({ game: f.dir, onProgress() {},
    request: async ({ stage, messages }) => {
      stages.push(stage); const data = JSON.parse(messages[1].content);
      if (stage === "plan") {
        assert.equal(data.reports[0].run.status, "incomplete");
        return JSON.stringify(plan);
      }
      assert.equal(data.rules, plan.rulesMarkdown);
      assert.equal(data.plan.changes[0].id, "C1");
      if (stage === "repair") { assert.match(data.errors, /Broken observation/); assert.equal(data.code, "broken"); }
      return stage === "implement" ? "```javascript\nbroken\n```" : f.code;
    }, validate: async (file, options) => {
      assert.equal(options.requireAgents, true);
      return (await fs.readFile(file, "utf8")) === "broken" ? failed : passed;
    } });
  assert.deepEqual(stages, ["plan", "implement", "repair"]);
  assert.equal(result.metadata.status, "validated");
  assert.equal(await fs.readFile(path.join(f.dir, "game.js"), "utf8"), f.code);
  assert.equal(await fs.readFile(path.join(f.dir, "rules.md"), "utf8"), f.rules);
  assert.equal(await fs.readFile(path.join(result.outDir, "rules.md"), "utf8"), plan.rulesMarkdown);
  assert.equal(await fs.readFile(path.join(result.outDir, "inputs", "game.js"), "utf8"), f.code);
  assert.match(await fs.readFile(path.join(result.outDir, "plan.md"), "utf8"), /report-1/);
  await fs.access(path.join(result.outDir, "index.html"));
  const calls = (await fs.readFile(path.join(result.outDir, "requests.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(calls.length, 3); assert.ok(calls.every(c => c.elapsedMs >= 0));
});

test("plan-only and unsupported-change results do not call implementation or validation", async t => {
  for (const planOnly of [true, false]) {
    const f = await fixture(t), plan = planFor(f.rules); if (!planOnly) plan.changes = [];
    let calls = 0;
    const result = await improveGame({ game: f.dir, planOnly, onProgress() {},
      request: async ({ stage }) => { calls++; assert.equal(stage, "plan"); return JSON.stringify(plan); },
      validate: () => assert.fail("Should not validate") });
    assert.equal(calls, 1);
    assert.equal(result.metadata.status, planOnly ? "planned" : "no_changes");
    await assert.rejects(fs.access(path.join(result.outDir, "game.js")));
  }
});

test("rejects unsupported evidence, undeclared rule changes, malformed plans and duplicate IDs", async t => {
  const f = await fixture(t), input = await loadImprovementInputs(f.dir);
  const plan = planFor(f.rules);
  assert.throws(() => parseImprovementPlan("oops", input), /valid JSON/);
  assert.throws(() => parseImprovementPlan(JSON.stringify({ ...plan, rulesMarkdown: "different" }), input), /without declaring/);
  assert.throws(() => parseImprovementPlan(JSON.stringify({ ...plan, changes: [plan.changes[0], plan.changes[0]] }), input), /Duplicate/);
  plan.changes[0].evidence[0].report = "invented";
  assert.throws(() => parseImprovementPlan(JSON.stringify(plan), input), /valid report evidence/);
  await assert.rejects(improveGame({ game: f.dir, onProgress() {}, request: async () => "not JSON" }), /valid JSON/);
  const [run] = await fs.readdir(path.join(f.dir, "improvements"));
  const out = path.join(f.dir, "improvements", run);
  assert.equal((JSON.parse(await fs.readFile(path.join(out, "improvement.json")))).status, "failed");
  assert.equal(await fs.readFile(path.join(out, "01-plan.response.txt"), "utf8"), "not JSON");
});

test("stream failure preserves partial code; validation failure never publishes a game", async t => {
  for (const streamFailure of [true, false]) {
    const f = await fixture(t);
    await assert.rejects(improveGame({ game: f.dir, maxRepairs: 0, onProgress() {}, validate: async () => failed,
      request: async ({ stage, onChunk }) => {
        if (stage === "plan") return JSON.stringify(planFor(f.rules));
        await onChunk("partial code");
        if (streamFailure) throw new Error("Timed out");
        return { text: "partial code" };
      } }), streamFailure ? /Timed out/ : /repair_limit_reached/);
    const [run] = await fs.readdir(path.join(f.dir, "improvements"));
    const out = path.join(f.dir, "improvements", run);
    await assert.rejects(fs.access(path.join(out, "game.js")));
    assert.equal(await fs.readFile(path.join(out, "02-implement.response.txt"), "utf8"), "partial code");
    assert.equal((JSON.parse(await fs.readFile(path.join(out, "improvement.json")))).status, "failed");
  }
});

test("input size limit stops before a model call; generation settings stay separate from playtest settings", async t => {
  const f = await fixture(t);
  await assert.rejects(improveGame({ game: f.dir, maxPromptChars: 10, onProgress() {}, request: () => assert.fail("No call allowed") }), /No content was truncated/);
  assert.equal(improvementModelSettings({ BAYLEAF_API_KEY: "test", MODEL: "generator", PLAYTEST_MODEL: "player" }).model, "generator");
  assert.equal(improvementModelSettings({ GEMINI_API_KEY: "test", GEMINI_MODEL: "gemini-test" }).model, "gemini-test");
});

test("saved plans use snapshots without replanning, preserve originals, and reject stale selections", async t => {
  const f = await fixture(t);
  const original = await improveGame({ game: f.dir, planOnly: true, onProgress() {}, request: async () => JSON.stringify(planFor(f.rules)) });
  await fs.writeFile(path.join(f.dir, "game.js"), "changed since plan");
  await assert.rejects(loadSavedImprovement(original.outDir, f.dir), /has changed/);
  await fs.writeFile(path.join(f.match, "report.md"), "report changed since plan");
  const stages = [];
  const result = await improveGame({ fromPlan: path.join(original.outDir, "plan.json"), onProgress() {}, validate: async () => passed,
    request: async ({ stage, messages }) => {
      stages.push(stage);
      const input = JSON.parse(messages[1].content);
      assert.equal(input.code, f.code);
      assert.deepEqual(input.plan, planFor(f.rules));
      return f.code;
    } });
  assert.deepEqual(stages, ["implement"]);
  assert.notEqual(result.outDir, original.outDir);
  assert.deepEqual(result.plan, original.plan);
  assert.equal(result.metadata.fromPlan, path.join(original.outDir, "plan.json"));
  assert.equal(await fs.readFile(path.join(f.dir, "game.js"), "utf8"), "changed since plan");
  assert.equal(JSON.parse(await fs.readFile(path.join(original.outDir, "improvement.json"))).status, "planned");
  await assert.rejects(loadSavedImprovement(path.join(original.outDir, "plan.md")), /readable summary/);
  await assert.rejects(improveGame({ fromPlan: original.outDir, reports: [f.match] }), /cannot be combined/);
  await fs.appendFile(path.join(original.outDir, "inputs", "report-1.md"), "tampered");
  await assert.rejects(loadSavedImprovement(original.outDir), /recorded hash/);
});

for (const resume of [false, true]) test(`CLI streams from a local mock, validates and records usage (saved plan: ${resume})`, async t => {
  const f = await fixture(t), requests = [];
  let gameReference = f.dir, planParent = path.join(f.dir, "improvements");
  if (!resume) {
    gameReference = await ensureProject("CLI Game", path.join(f.dir, "library"));
    const versionDir = await createVersion(gameReference);
    await fs.writeFile(path.join(versionDir, "game.js"), f.code);
    await fs.writeFile(path.join(versionDir, "rules.md"), f.rules);
    await setVersionStatus(versionDir, "validated");
    await fs.cp(f.match, path.join(await playtestsDirectory(versionDir), "run-001"), { recursive: true });
    planParent = path.join(gameReference, "plans");
  }
  const saved = resume ? await improveGame({ game: f.dir, planOnly: true, onProgress() {}, request: async () => JSON.stringify(planFor(f.rules)) }) : null;
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const data = JSON.parse(body); requests.push(data);
    const answer = !resume && requests.length === 1 ? JSON.stringify(planFor(f.rules)) : f.code + "\n// revised fixture\n";
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: answer }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const result = await promisify(execFile)(process.execPath, [path.join(projectDir, "improve.js"), ...(resume ? ["--from-plan", saved.outDir] : [gameReference, "--version", "v001"]), "--provider", "bayleaf", "--model", "mock", "--max-repairs", "0"],
    { timeout: 30_000, env: { ...process.env, BAYLEAF_API_KEY: "test-secret", BASE_URL: `http://127.0.0.1:${server.address().port}/v1` } });
  assert.match(result.stdout, /Validated revised game/);
  assert.equal(requests.length, resume ? 1 : 2);
  const [run] = (await fs.readdir(planParent)).filter(name => name !== (saved && path.basename(saved.outDir)));
  const out = path.join(planParent, run);
  const metadata = await fs.readFile(path.join(out, "improvement.json"), "utf8");
  assert.equal(JSON.parse(metadata).status, "validated");
  if (!resume) await fs.access(path.join(gameReference, "versions", "v002", "game.js"));
  assert.ok(!metadata.includes("test-secret"));
  const usage = (await fs.readFile(path.join(out, "requests.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(usage.length, resume ? 1 : 2); assert.ok(usage.every(r => r.usage.total_tokens === 30));
});
