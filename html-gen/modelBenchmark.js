// Frozen-position comparison. Records exact prompts, choices, usage and wall-clock latency.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import dotenv from "dotenv";
import { loadPlaytestEngine } from "./playtestEngine.js";
import { boundedHistory, playerFacts, withoutSeeds } from "./playtestRunner.js";
import { moveInstructions, parseAgentReply, modelSettings } from "./playerAgent.js";

const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => createHash("sha256").update(value).digest("hex");

export async function prepareCases(config, baseDir) {
  const cases = [];
  for (const source of config.sources) {
    const dir = path.resolve(baseDir, source.match);
    const replay = JSON.parse(await fs.readFile(path.join(dir, "replay.json"), "utf8"));
    const metadata = JSON.parse(await fs.readFile(path.join(dir, "metadata.json"), "utf8"));
    const code = await fs.readFile(path.join(dir, "game.js"));
    if (metadata.gameSha256 && metadata.gameSha256 !== hash(code)) throw new Error("Archived game hash mismatch");
    const rules = await fs.readFile(path.join(dir, "rules.md"), "utf8");
    const events = (await fs.readFile(path.join(dir, "transcript.jsonl"), "utf8")).trim().split(/\r?\n/).map(JSON.parse);
    const engine = await loadPlaytestEngine(path.join(dir, "game.js"));
    try {
      let state = copy(replay.initialState);
      const previous = [];
      for (const entry of replay.moves) {
        const record = events.find(e => e.type === "move_accepted" && e.decision === entry.decision);
        if (!record || !isDeepStrictEqual(record.move, entry.move)) throw new Error("Transcript/replay mismatch");
        if (source.decisions.includes(entry.decision)) {
          const player = entry.player;
          const observe = s => engine.call("agentObservation", withoutSeeds(engine.info.hasObserve ? engine.call("observe", s, player) : copy(s)), player);
          const observed = withoutSeeds(engine.info.hasObserve ? engine.call("observe", state, player) : copy(state));
          const observation = observe(state);
          if (!isDeepStrictEqual(observation, record.observation)) throw new Error("Recorded observation mismatch");
          const legal = engine.call("legalMoves", state);
          const legalMoves = legal.map((move, i) => ({ id: `d${entry.decision}-m${i + 1}`, ...engine.call("describeAction", observed, move, player) }));
          const facts = events.filter(e => e.type === "player_observed" && e.viewer === player && e.decision < entry.decision)
            .map(({ decision, player, publicEvent, changes, omittedChanges, selectedAction }) => ({ decision, player, publicEvent, changes, omittedChanges, ...(selectedAction ? { selectedAction } : {}) }));
          const input = { rules, gameContext: engine.call("agentContext"), player, name: metadata.seats[player - 1].name,
            players: replay.players, matchDecisionNumber: entry.decision, yourDecisionNumber: previous.filter(m => m.player === player).length + 1,
            recordedFacts: playerFacts(player, previous, null, observation, "running"), factualHistory: boundedHistory(facts, 3000), observation,
            availableActionCounts: Object.fromEntries([...new Set(legalMoves.map(a => a.category))].map(c => [c, legalMoves.filter(a => a.category === c).length])), legalMoves };
          const messages = [{ role: "system", content: moveInstructions }, { role: "user", content: JSON.stringify(input) }];
          cases.push({ id: `${source.id}-d${entry.decision}`, source: dir, gameSha256: hash(code), player, decision: entry.decision,
            input, messages, promptSha256: hash(JSON.stringify(messages)),
            // These are for offline assessment only. Never sent to a candidate model.
            outcomes: legal.map((move, i) => ({ moveId: legalMoves[i].id, move, action: legalMoves[i],
              after: observe(engine.call("applyMove", state, move)) })) });
        }
        previous.push(record);
        state = engine.call("applyMove", state, entry.move);
      }
      if (!isDeepStrictEqual(state, replay.finalState)) throw new Error("Reconstructed final state mismatch");
    } finally { engine.close(); }
    for (const decision of source.decisions) if (!cases.some(c => c.id === `${source.id}-d${decision}`)) throw new Error(`Missing decision ${decision}`);
  }
  return cases;
}

export function summarize(config, cases, attempts) {
  const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const median = xs => { const a = [...xs].sort((a, b) => a - b); return a.length ? (a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2 : null; };
  return config.variants.map(v => {
    const rows = attempts.filter(a => a.variant === v.id);
    const accepted = rows.filter(a => a.accepted);
    const field = (key, nested) => {
      const values = rows.map(r => nested ? r.usage?.[nested]?.[key] : r.usage?.[key]).filter(Number.isFinite);
      return { reported: values.reduce((a, b) => a + b, 0), requestsWithoutValue: rows.length - values.length };
    };
    return { variant: v.id, model: v.model, cases: cases.length, accepted: accepted.length,
      firstAttemptAccepted: accepted.filter(a => a.attempt === 1).length, requests: rows.length,
      meanRequestMs: mean(rows.map(a => a.elapsedMs)), medianRequestMs: median(rows.map(a => a.elapsedMs)),
      meanTestedCaseMs: rows.length ? rows.reduce((n, r) => n + r.elapsedMs, 0) / new Set(rows.map(r => r.caseId)).size : null,
      meanAcceptedDecisionMs: mean(accepted.map(a => rows.filter(r => r.caseId === a.caseId).reduce((n, r) => n + r.elapsedMs, 0))),
      totalRequestMs: rows.reduce((n, r) => n + r.elapsedMs, 0),
      inputTokens: field("prompt_tokens"), outputTokens: field("completion_tokens"), totalTokens: field("total_tokens"),
      reasoningTokens: field("reasoning_tokens", "completion_tokens_details") };
  });
}

export async function runBenchmark(configFile) {
  const config = JSON.parse(await fs.readFile(configFile, "utf8"));
  const baseDir = path.dirname(path.resolve(configFile));
  dotenv.config({ path: [fileURLToPath(new URL("./.env", import.meta.url)), fileURLToPath(new URL("../.env", import.meta.url))], quiet: true });
  const settings = modelSettings(process.env, { provider: "bayleaf" });
  const outDir = path.resolve(baseDir, config.output);
  await fs.mkdir(outDir, { recursive: true });
  const cases = await prepareCases(config, baseDir);
  const catalogResponse = await fetch(`${settings.baseURL.replace(/\/$/, "")}/models`, { headers: { Authorization: `Bearer ${settings.apiKey}` }, signal: AbortSignal.timeout(30000) });
  if (!catalogResponse.ok) throw new Error(`Model catalog HTTP ${catalogResponse.status}`);
  const catalog = (await catalogResponse.json()).data;
  for (const v of config.variants) if (!catalog.some(m => m.id === v.model)) throw new Error(`Model missing: ${v.model}`);
  await fs.writeFile(path.join(outDir, "models.json"), JSON.stringify(catalog.filter(m => config.variants.some(v => v.model === m.id)), null, 2));
  const casesFile = path.join(outDir, "cases.json");
  try { if (!isDeepStrictEqual(JSON.parse(await fs.readFile(casesFile, "utf8")), cases)) throw new Error("Saved cases differ; choose a fresh output directory"); }
  catch (e) { if (e.code !== "ENOENT") throw e; await fs.writeFile(casesFile, JSON.stringify(cases, null, 2)); }
  const savedConfig = path.join(outDir, "config.json");
  try { if (!isDeepStrictEqual(JSON.parse(await fs.readFile(savedConfig, "utf8")), config)) throw new Error("Saved configuration differs; choose a fresh output directory"); }
  catch (e) { if (e.code !== "ENOENT") throw e; await fs.writeFile(savedConfig, JSON.stringify(config, null, 2)); }
  const attemptsFile = path.join(outDir, "attempts.jsonl");
  let attempts = [];
  try { attempts = (await fs.readFile(attemptsFile, "utf8")).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse); }
  catch (e) { if (e.code !== "ENOENT") throw e; }
  // Sequential requests, rotating model order per position to reduce order bias without contention.
  for (let index = 0; index < cases.length; index++) {
    const c = cases[index];
    for (let offset = 0; offset < config.variants.length; offset++) {
      const v = config.variants[(index + offset) % config.variants.length];
      let previous = attempts.filter(a => a.variant === v.id && a.caseId === c.id);
      if (previous.some(a => a.accepted)) continue;
      for (let attempt = previous.length + 1; attempt <= config.maxAttempts; attempt++) {
        const correction = previous.at(-1)?.error;
        const maxTokens = previous.at(-1)?.finishReason === "length" ? config.retryMaxTokens : config.maxTokens;
        const body = { model: v.model, messages: [...c.messages, ...(correction ? [{ role: "user", content: `The previous response failed validation: ${correction}. Return a corrected JSON object.` }] : [])],
          max_tokens: maxTokens, ...(v.reasoning ? { reasoning: v.reasoning } : {}) };
        const row = { variant: v.id, model: v.model, caseId: c.id, attempt, requestedAt: new Date().toISOString(),
          promptSha256: c.promptSha256, requestSha256: hash(JSON.stringify(body)), maxTokens, reasoning: v.reasoning ?? null };
        const start = performance.now();
        try {
          const response = await fetch(`${settings.baseURL.replace(/\/$/, "")}/chat/completions`, {
            method: "POST", headers: { Authorization: `Bearer ${settings.apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(body), signal: AbortSignal.timeout(config.timeoutMs) });
          row.httpStatus = response.status;
          const text = await response.text();
          row.elapsedMs = Math.round(performance.now() - start);
          const data = JSON.parse(text);
          row.responseId = data.id ?? null; row.returnedModel = data.model ?? null;
          row.usage = data.usage ?? null; row.finishReason = data.choices?.[0]?.finish_reason ?? null;
          row.rawResponse = data.choices?.[0]?.message?.content ?? null;
          // Keep usage/metadata, not private model reasoning text.
          if (!response.ok || data.error) throw new Error(`HTTP ${response.status}: ${data.error?.message || "provider error"}`);
          if (row.finishReason === "length") throw new Error("Output token limit reached");
          row.reply = parseAgentReply(row.rawResponse, "move", c.input.legalMoves);
          row.selected = c.outcomes.find(o => o.moveId === row.reply.moveId);
          row.accepted = true;
        } catch (e) { row.elapsedMs ??= Math.round(performance.now() - start); row.accepted = false; row.error = String(e.message).replaceAll(settings.apiKey, "[REDACTED]").slice(0, 500); }
        attempts.push(row); previous.push(row);
        await fs.appendFile(attemptsFile, JSON.stringify(row) + "\n");
        await fs.writeFile(path.join(outDir, "summary.json"), JSON.stringify(summarize(config, cases, attempts), null, 2));
        console.log(`${v.id} ${c.id} attempt ${attempt}: ${row.accepted ? "accepted" : row.error} | ${row.elapsedMs} ms | ${row.usage?.total_tokens ?? "unknown"} tokens`);
        if (row.accepted) break;
        if ([401, 403].includes(row.httpStatus)) throw new Error("Provider authorization failed; saved partial results");
      }
    }
  }
  const csv = ["variant,case,attempt,accepted,elapsed_ms,input_tokens,output_tokens,reasoning_tokens,total_tokens,finish_reason",
    ...attempts.map(a => [a.variant, a.caseId, a.attempt, a.accepted, a.elapsedMs, a.usage?.prompt_tokens,
      a.usage?.completion_tokens, a.usage?.completion_tokens_details?.reasoning_tokens, a.usage?.total_tokens, a.finishReason]
      .map(v => JSON.stringify(String(v ?? ""))).join(","))].join("\n");
  await fs.writeFile(path.join(outDir, "timings.csv"), csv);
  console.log(`Saved benchmark to ${outDir}`);
  return outDir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) { console.error("Usage: node modelBenchmark.js <config.json>"); process.exitCode = 1; }
  else runBenchmark(process.argv[2]).catch(e => { console.error(e.message); process.exitCode = 1; });
}
