// Standalone playtesting for an existing generated game; never runs the generation pipeline.
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { loadPlaytestEngine } from "./playtestEngine.js";
import { createPlayerAgent, modelSettings, defaultBayleafPlaytestModel } from "./playerAgent.js";
import { runPlaytest } from "./playtestRunner.js";
import { buildReplayViewer } from "./replay.js";
import { resolveGame, playtestsDirectory, numberedDirectory } from "./gameStorage.js";

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const help = `Usage: npm run playtest -- <game-name | game.js | index.html | game-directory> [options]

Each player independently chooses every move and writes a final reflection.
Requires the agent interface in newly generated games (no legacy adapters).
Outputs: report.md, transcript.jsonl, replay.json, replay.html, metadata.json, agent-context.json, game.js, rules.md.
Open replay.html in a browser to watch the saved game (no server or API key needed).

  --players N             Player count (default: game's default)
  --version ID            v001, v002, or latest (named projects default to latest validated)
  --provider NAME         bayleaf or gemini (also PLAYTEST_PROVIDER)
  --model ID              Player model (also PLAYTEST_MODEL)
  --rules FILE            Rules file (default: adjacent rules.md, then engine.rules)
  --out DIR               Parent directory for a new unique match directory
  --max-moves N           Maximum decisions (default: 500)
  --max-minutes N         Gameplay time budget (default: 30; reflections are additional)
  --timeout N             Seconds per model request (default: 60)
  --retries N             Retries per decision/reflection (default: 2)
  --planning on|off       Private, revisable plan memory (default: off)
  --endgame-awareness on|off  Emphasize ending/scoring/time remaining (default: off)
  --move-tokens N         Maximum output tokens per move (Kimi: 8192; others: 350)
  --reflection-tokens N   Maximum output tokens per reflection (Kimi: 8192; others: 1200)
  --max-prompt-chars N    Maximum serialized input per request (default: 100000)
  --help                  Show this message without contacting a model

BayLeaf default: ${defaultBayleafPlaytestModel} (low reasoning effort)
Gemini default: gemini-3.5-flash-lite
Credentials: BAYLEAF_API_KEY or GEMINI_API_KEY in html-gen/.env or ../.env.
PLAYTEST_BASE_URL overrides the endpoint; BayLeaf also accepts BASE_URL.
Exit status: 0 = completed game and all feedback; 1 = incomplete/failed run.
Ctrl+C saves partial progress and skips remaining model requests.`;

function numberOption(values, key, fallback, { integer = true, minimum = 1 } = {}) {
  const number = values[key] === undefined ? fallback : Number(values[key]);
  if (!Number.isFinite(number) || (integer && !Number.isSafeInteger(number)) || number < minimum) {
    throw new Error(`--${key} must be ${integer ? "an integer" : "a number"} >= ${minimum}`);
  }
  return number;
}

export function toggleOption(value, key) {
  if (value === undefined || value === "off") return false;
  if (value === "on") return true;
  throw new Error(`--${key} must be on or off`);
}

export async function main(argv = process.argv.slice(2)) {
  const stringOptions = ["players", "provider", "model", "rules", "out", "max-moves", "max-minutes", "timeout", "retries", "move-tokens", "reflection-tokens", "max-prompt-chars", "planning", "endgame-awareness", "version"];
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true,
    options: { help: { type: "boolean" }, ...Object.fromEntries(stringOptions.map((key) => [key, { type: "string" }])) } });
  if (values.help) { console.log(help); return; }
  if (positionals.length !== 1) throw new Error(help);
  dotenv.config({ path: [path.join(projectDir, ".env"), path.join(projectDir, "..", ".env")], quiet: true });
  const settings = modelSettings(process.env, values);
  const options = {
    maxMoves: numberOption(values, "max-moves", 500),
    maxMinutes: numberOption(values, "max-minutes", 30, { integer: false, minimum: 0.001 }),
    timeoutMs: numberOption(values, "timeout", 60, { integer: false, minimum: 0.001 }) * 1000,
    retries: numberOption(values, "retries", 2, { minimum: 0 }),
    moveTokens: numberOption(values, "move-tokens", settings.outputTokenLimits.move),
    reflectionTokens: numberOption(values, "reflection-tokens", settings.outputTokenLimits.reflection),
    maxPromptChars: numberOption(values, "max-prompt-chars", 100_000),
    planning: toggleOption(values.planning, "planning"),
    endgameAwareness: toggleOption(values["endgame-awareness"], "endgame-awareness"),
  };
  options.timeoutMs = Math.ceil(options.timeoutMs);
  const resolved = await resolveGame(positionals[0], values.version);
  const gameFile = resolved.gameFile;
  const engine = await loadPlaytestEngine(gameFile);
  const controller = new AbortController();
  const interrupt = () => { console.log("\nStopping and saving partial results..."); controller.abort(new Error("Interrupted by user")); };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    const players = numberOption(values, "players", engine.info.players);
    if (players < engine.info.minPlayers || players > engine.info.maxPlayers) throw new Error(`Game supports ${engine.info.minPlayers}–${engine.info.maxPlayers} players`);
    let rules = engine.info.rules;
    try { rules = await fs.readFile(values.rules ? path.resolve(values.rules) : path.join(path.dirname(gameFile), "rules.md"), "utf8"); }
    catch (error) { if (values.rules || error.code !== "ENOENT") throw error; }
    if (typeof rules !== "string" || !rules.trim()) throw new Error("Provide rules.md or GameEngine.rules before playtesting");
    const parent = values.out ? path.resolve(values.out) : await playtestsDirectory(path.dirname(gameFile));
    const outDir = await numberedDirectory(parent, "run-");
    const code = await fs.readFile(gameFile);
    await fs.writeFile(path.join(outDir, "game.js"), code);
    await fs.writeFile(path.join(outDir, "rules.md"), rules);
    console.log(`Playtesting ${engine.info.name}: ${players} players using ${settings.provider} / ${settings.model}`);
    console.log(`Saving to ${outDir}`);
    const result = await runPlaytest({ engine, rules, players, outDir, ...options,
      provider: settings.provider, model: settings.model, signal: controller.signal,
      provenance: { gameFile, gameSha256: createHash("sha256").update(code).digest("hex"), reasoning: settings.reasoning,
        ...(resolved.version ? { version: resolved.version, project: resolved.project.slug } : {}),
        outputTokenLimits: { move: options.moveTokens, reflection: options.reflectionTokens } },
      agentFactory: () => createPlayerAgent(settings, options),
      onEvent(event) {
        if (event.type === "agent_deciding") console.log(`Decision ${event.decision}: player ${event.player} is deciding...`);
        if (event.type === "move_accepted") console.log(`  Selected action: ${event.action.label}\n  Feeling: ${event.feeling}\n  Explanation (unverified): ${event.reason}\n  Move: ${JSON.stringify(event.move)}`);
        if (event.type === "agent_error") console.log(`  Player ${event.player} ${event.kind}, attempt ${event.attempt}: ${event.error}`);
        if (event.type === "game_ended") console.log(`Game ${event.status}: ${JSON.stringify(event.result)}${event.reason ? ` (${event.reason})` : ""}`);
        if (event.type === "reflection_received") console.log(`Player ${event.player} feedback ${event.feedback ? "saved" : "unavailable"}.`);
      },
    });
    console.log(`Report: ${path.join(outDir, "report.md")}`);
    if (result.replay.initialState) {
      try { console.log(`Replay: ${await buildReplayViewer(outDir)} (open in a browser)`); }
      catch (error) { console.error(`Replay viewer could not be built: ${error.message}. Retry with npm run replay -- "${outDir}"`); }
    }
    if (result.metadata.status !== "complete" || result.metadata.feedbackStatus !== "complete") process.exitCode = 1;
    return result;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    engine.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
