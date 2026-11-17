import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ChatOpenAI } from "@langchain/openai";
import { improveGame } from "./improveRunner.js";
import { resolveGame, resolvePlan } from "./gameStorage.js";

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const help = `Usage: npm run improve -- <game-name | game-directory | game.js | index.html> [options]
       npm run improve -- --from-plan <improvement-directory | plan.json> [options]

Reads playtest reports, saves an improvement plan, implements it, then validates/repairs.
Named games save plans in plans/plan-001 and revised code in versions/v002.
Original games and playtests are preserved. No new LLM playtest is run automatically.

  --report PATH          Report file or match directory (repeatable; default: all matching playtests)
  --plan-only            Save the plan without implementation or validation calls
  --from-plan PATH       Apply a saved plan to its source snapshot; skip planning
  --version ID           Source version (default: latest validated for named games)
                         With a game name, --from-plan also accepts latest or plan-001
  --out DIR              Parent directory for a unique improvement run
  --provider NAME        bayleaf or gemini (default: generation PROVIDER setting)
  --model ID             Override the generation model (MODEL or GEMINI_MODEL)
  --timeout N            Seconds per generation (default: LLM_TIMEOUT or 1200)
  --max-repairs N        Validation repair attempts (default: MAX_REPAIRS or 5)
  --max-prompt-chars N   Reject larger prompts without truncation (default: 500000)
  --help                 Show help without contacting a model

Uses generation credentials/settings from html-gen/.env, then ../.env.
Review plan.md and improvement.json; passing validation does not establish better gameplay.`;

export function improvementModelSettings(env = process.env, overrides = {}) {
  const provider = (overrides.provider || env.PROVIDER || (env.BAYLEAF_API_KEY?.trim() ? "bayleaf" : "gemini")).toLowerCase();
  if (!["bayleaf", "gemini"].includes(provider)) throw new Error("Provider must be bayleaf or gemini");
  const keyName = provider === "bayleaf" ? "BAYLEAF_API_KEY" : "GEMINI_API_KEY";
  if (!env[keyName]?.trim()) throw new Error(`Set ${keyName} before improving a game`);
  return { provider, model: overrides.model || (provider === "bayleaf" ? env.MODEL || "openrouter:moonshotai/kimi-k3.1-pro" : env.GEMINI_MODEL || "gemini-3.8-flash"),
    apiKey: env[keyName], baseURL: provider === "bayleaf" ? env.BASE_URL || "https://api.bayleaf.dev/v1" : "https://generativelanguage.googleapis.com/v1beta/openai/" };
}

export function createImprovementRequester(settings, { timeoutMs = 1_200_000, signal } = {}) {
  const model = new ChatOpenAI({ model: settings.model, apiKey: settings.apiKey,
    configuration: { baseURL: settings.baseURL }, streaming: true, timeout: timeoutMs + 5000, maxRetries: 2 });
  return async ({ messages, onChunk }) => {
    const deadline = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([deadline, signal]) : deadline;
    let usage = null;
    const ticker = setInterval(() => console.log("  Still waiting for the generation..."), 30_000);
    try {
      const stream = await model.stream(messages, { signal: combined });
      for await (const chunk of stream) {
        const text = typeof chunk.content === "string" ? chunk.content : chunk.content.filter(p => p.type === "text").map(p => p.text).join("");
        if (text) await onChunk(text);
        if (chunk.usage_metadata) usage = chunk.usage_metadata;
      }
      return { text: "", usage };
    } catch (error) {
      if (signal?.aborted) throw new Error("Improvement interrupted; partial response saved", { cause: error });
      if (deadline.aborted) throw new Error(`Generation timed out after ${timeoutMs / 1000}s; partial response saved`, { cause: error });
      throw error;
    } finally { clearInterval(ticker); }
  };
}

export async function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    help: { type: "boolean" }, "plan-only": { type: "boolean" }, report: { type: "string", multiple: true },
    ...Object.fromEntries(["out", "provider", "model", "timeout", "max-repairs", "max-prompt-chars", "from-plan", "version"].map(key => [key, { type: "string" }])) } });
  if (values.help) { console.log(help); return; }
  if (positionals.length > 1 || (!values["from-plan"] && positionals.length !== 1)) throw new Error(help);
  if (values["from-plan"] && (values.report?.length || values["plan-only"])) throw new Error("--from-plan cannot be combined with --report or --plan-only");
  dotenv.config({ path: [path.join(projectDir, ".env"), path.join(projectDir, "..", ".env")], quiet: true });
  const numeric = (value, name, min, integer = true) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || (integer && !Number.isSafeInteger(n))) throw new Error(`${name} must be ${integer ? "an integer" : "a number"} >= ${min}`);
    return n;
  };
  const timeoutMs = Math.ceil(numeric(values.timeout ?? process.env.LLM_TIMEOUT ?? 1200, "timeout", 0.001, false) * 1000);
  const maxRepairs = numeric(values["max-repairs"] ?? process.env.MAX_REPAIRS ?? 5, "max-repairs", 0);
  const maxPromptChars = numeric(values["max-prompt-chars"] ?? 500_000, "max-prompt-chars", 1);
  const settings = improvementModelSettings(process.env, values);
  let game = positionals[0], fromPlan = values["from-plan"];
  if (fromPlan) {
    const shortPlan = /^(latest|plan-\d+)$/.test(fromPlan);
    fromPlan = await resolvePlan(fromPlan, game);
    if (game && (!shortPlan || values.version)) game = (await resolveGame(game, values.version)).gameDir;
    else if (shortPlan) game = undefined; // Use the plan's saved source, even if a newer version now exists.
  }
  const controller = new AbortController();
  const stop = () => controller.abort(new Error("Interrupted by user"));
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    const result = await improveGame({ game, version: values.version, fromPlan, reports: values.report, outputParent: values.out,
      maxRepairs, maxPromptChars, planOnly: values["plan-only"] ?? false,
      modelInfo: { provider: settings.provider, model: settings.model, timeoutMs },
      request: createImprovementRequester(settings, { timeoutMs, signal: controller.signal }) });
    console.log(`Plan: ${path.join(result.outDir, "plan.md")}`);
    if (result.metadata.status === "validated") console.log(`Validated revised game: ${path.join(result.gameDir, "index.html")}\nRun a new playtest to evaluate the changes.`);
    else console.log(result.metadata.status === "no_changes" ? "No supported changes proposed; no revised game generated." : "Plan saved; implementation skipped (--plan-only).");
    return result;
  } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
