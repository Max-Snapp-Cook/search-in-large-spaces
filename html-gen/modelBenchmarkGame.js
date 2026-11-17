// Full-game follow-up using a benchmark configuration and an archived initial state.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import dotenv from "dotenv";
import { loadPlaytestEngine } from "./playtestEngine.js";
import { runPlaytest } from "./playtestRunner.js";
import { modelSettings, moveInstructions, reflectionInstructions } from "./playerAgent.js";
import { buildReplayViewer } from "./replay.js";

async function main(configFile, variantId) {
  const config = JSON.parse(await fs.readFile(configFile, "utf8"));
  const baseDir = path.dirname(path.resolve(configFile));
  const variant = config.variants.find(v => v.id === variantId);
  if (!variant) throw new Error("Unknown benchmark variant");
  dotenv.config({ path: [fileURLToPath(new URL("./.env", import.meta.url)), fileURLToPath(new URL("../.env", import.meta.url))], quiet: true });
  const settings = modelSettings(process.env, { provider: "bayleaf", model: variant.model });
  const source = path.resolve(baseDir, config.sources[0].match);
  const replay = JSON.parse(await fs.readFile(path.join(source, "replay.json"), "utf8"));
  const parent = path.resolve(baseDir, config.output, "full-games");
  await fs.mkdir(parent, { recursive: true });
  const outDir = await fs.mkdtemp(path.join(parent, `${variantId}-`));
  const code = await fs.readFile(path.join(source, "game.js"));
  const rules = await fs.readFile(path.join(source, "rules.md"), "utf8");
  await fs.writeFile(path.join(outDir, "game.js"), code);
  await fs.writeFile(path.join(outDir, "rules.md"), rules);
  const loaded = await loadPlaytestEngine(path.join(outDir, "game.js"));
  const engine = { info: loaded.info, call(method, ...args) {
    return method === "initialState" ? structuredClone(replay.initialState) : loaded.call(method, ...args);
  } };
  const controller = new AbortController();
  const stop = () => controller.abort(new Error("Interrupted"));
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  const start = performance.now();
  console.log(`Full game ${variantId}: ${outDir}`);
  try {
    const result = await runPlaytest({ engine, rules, players: replay.players, outDir, provider: "bayleaf", model: variant.model,
      maxMoves: 100, maxMinutes: 15, timeoutMs: config.timeoutMs, retries: 1, signal: controller.signal,
      provenance: { gameFile: path.join(source, "game.js"), gameSha256: createHash("sha256").update(code).digest("hex"),
        initialStateSource: path.join(source, "replay.json"), reasoning: variant.reasoning ?? null,
        outputTokenLimits: { move: config.retryMaxTokens, reflection: config.retryMaxTokens } },
      agentFactory: () => ({ async respond(kind, input, { signal, correction }) {
        const body = { model: variant.model, max_tokens: config.retryMaxTokens, ...(variant.reasoning ? { reasoning: variant.reasoning } : {}),
          messages: [{ role: "system", content: kind === "move" ? moveInstructions : reflectionInstructions },
            { role: "user", content: JSON.stringify(input) }, ...(correction ? [{ role: "user", content: `The previous response failed validation: ${correction}. Return a corrected JSON object.` }] : [])] };
        const started = performance.now();
        let data, status, error;
        try {
          const response = await fetch(`${settings.baseURL.replace(/\/$/, "")}/chat/completions`, { method: "POST", signal,
            headers: { Authorization: `Bearer ${settings.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
          status = response.status; data = await response.json();
          if (!response.ok || data.error) throw new Error(`HTTP ${status}: ${data.error?.message || "provider error"}`);
        } catch (e) { error = String(e.message).replaceAll(settings.apiKey, "[REDACTED]"); throw new Error(error); }
        finally {
          await fs.appendFile(path.join(outDir, "requests.jsonl"), JSON.stringify({ kind, player: input.player, decision: input.matchDecisionNumber ?? null,
            elapsedMs: Math.round(performance.now() - started), usage: data?.usage ?? null, responseId: data?.id ?? null, returnedModel: data?.model ?? null,
            finishReason: data?.choices?.[0]?.finish_reason ?? null, maxTokens: body.max_tokens, reasoning: variant.reasoning ?? null, httpStatus: status ?? null, error: error ?? null }) + "\n");
        }
        const u = data.usage;
        return { raw: data.choices?.[0]?.message?.content ?? "", finishReason: data.choices?.[0]?.finish_reason ?? null,
          usage: u ? { input_tokens: u.prompt_tokens, output_tokens: u.completion_tokens, total_tokens: u.total_tokens,
            output_token_details: { reasoning: u.completion_tokens_details?.reasoning_tokens ?? null } } : null };
      } }),
      onEvent(e) {
        if (e.type === "move_accepted") console.log(`${variantId} decision ${e.decision}: ${e.action.label}`);
        if (e.type === "agent_error") console.log(`${variantId} request failed: ${e.error}`);
      }
    });
    await fs.writeFile(path.join(outDir, "benchmark-run.json"), JSON.stringify({ variant, elapsedMs: Math.round(performance.now() - start),
      status: result.metadata.status, feedbackStatus: result.metadata.feedbackStatus, result: result.metadata.result }, null, 2));
    if (result.replay.initialState) await buildReplayViewer(outDir);
    console.log(`Saved ${variantId}: ${outDir}; ${result.metadata.status}; ${JSON.stringify(result.metadata.result)}`);
  } finally {
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); loaded.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2], process.argv[3]).catch(e => { console.error(e.message); process.exitCode = 1; });
}
