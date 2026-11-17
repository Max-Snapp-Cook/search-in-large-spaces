// Build an offline viewer beside the archived game. No server, model requests, or new game setup.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { summarizeDiagnostics } from "./playtestDiagnostics.js";

async function optional(file, fallback) {
  try { return await fs.readFile(file, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

export async function buildReplayViewer(input) {
  let dir = path.resolve(input);
  if (!(await fs.stat(dir)).isDirectory()) {
    if (path.basename(dir) !== "replay.json") throw new Error("Supply a match directory or its replay.json");
    dir = path.dirname(dir);
  }
  const [replayText, code, metadataText, transcript, template, controller, shell] = await Promise.all([
    fs.readFile(path.join(dir, "replay.json"), "utf8"), fs.readFile(path.join(dir, "game.js")),
    optional(path.join(dir, "metadata.json"), "{}"), optional(path.join(dir, "transcript.jsonl"), ""),
    fs.readFile(new URL("./shell/replay.html", import.meta.url), "utf8"),
    fs.readFile(new URL("./shell/replay.js", import.meta.url), "utf8"),
    fs.readFile(new URL("./shell/index.html", import.meta.url), "utf8"),
  ]);
  const replay = JSON.parse(replayText), metadata = JSON.parse(metadataText);
  if (!replay.initialState || !Array.isArray(replay.moves) || !Number.isSafeInteger(replay.players) || replay.players < 1) {
    throw new Error("Replay needs an initial state, player count, and moves array");
  }
  if (metadata.gameSha256 && createHash("sha256").update(code).digest("hex") !== metadata.gameSha256) {
    throw new Error("Archived game.js does not match the playtest's recorded hash");
  }
  const events = transcript.trim() ? transcript.trim().split(/\r?\n/).map(JSON.parse) : [];
  const records = events.filter(e => e.type === "move_accepted" && e.decision <= replay.moves.length);
  const data = { replay, metadata: { status: metadata.status, reason: metadata.reason, provider: metadata.provider,
    model: metadata.model, startedAt: metadata.startedAt }, records,
    reflections: events.filter(e => e.type === "reflection_received"),
    errors: summarizeDiagnostics(events).errors,
    report: await optional(path.join(dir, "report.md"), null) };
  const kit = [...shell.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes("window.GameKit ="));
  if (!kit) throw new Error("GameKit not found in shell");
  // Escape HTML delimiters in data so commentary can never terminate the JSON script element.
  const json = JSON.stringify(data).replaceAll("<", "\\u003c");
  // Store the exact source as inert JSON, then execute it through a DOM-created script.
  // This preserves strings/comments containing </script> or <!-- without HTML parsing them.
  const gameSource = JSON.stringify(code.toString("utf8")).replaceAll("<", "\\u003c");
  const replacements = { "/* REPLAY_KIT */": kit, REPLAY_GAME_SOURCE: gameSource,
    REPLAY_DATA: json, "/* REPLAY_CONTROLLER */": controller };
  // One pass prevents placeholder-like text in game code or commentary being replaced.
  const html = template.replace(/\/\* REPLAY_KIT \*\/|REPLAY_GAME_SOURCE|REPLAY_DATA|\/\* REPLAY_CONTROLLER \*\//g,
    token => replacements[token]);
  const file = path.join(dir, "replay.html");
  await fs.writeFile(`${file}.tmp`, html);
  await fs.rename(`${file}.tmp`, file);
  return file;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] === "--help") {
    console.log("Usage: npm run replay -- <match-directory | replay.json>\nCreates replay.html beside the saved game; open it in a browser. No server or API key required.");
    if (args[0] !== "--help") process.exitCode = 1;
  } else buildReplayViewer(args[0]).then(file => console.log(`Open in a browser: ${file}`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
