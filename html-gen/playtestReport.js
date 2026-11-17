// Rebuild a saved report from existing evidence only; no engine execution or LLM requests.
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderReport } from "./playtestRunner.js";
import { summarizeDiagnostics } from "./playtestDiagnostics.js";

export async function rebuildReport(directory) {
  const dir = path.resolve(directory);
  const metadata = JSON.parse(await fs.readFile(path.join(dir, "metadata.json"), "utf8"));
  const events = (await fs.readFile(path.join(dir, "transcript.jsonl"), "utf8")).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  if (!events.some(event => event.type === "run_finished")) throw new Error("Only rebuild finished runs; the playtester may still be writing this report");
  const moves = events.filter(e => e.type === "move_accepted").map(e => ({ ...e,
    action: e.action ?? { label: e.publicEvent || JSON.stringify(e.move) } }));
  const reflections = events.filter(e => e.type === "reflection_received");
  const diagnostics = summarizeDiagnostics(events);
  const report = renderReport({ ...metadata, diagnostics }, moves, reflections);
  const file = path.join(dir, "report.md");
  const backup = path.join(dir, "report.original.md");
  try { await fs.copyFile(file, backup, constants.COPYFILE_EXCL); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  await fs.writeFile(`${file}.tmp`, report);
  await fs.rename(`${file}.tmp`, file);
  return { file, backup, diagnostics };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 1) { console.error("Usage: npm run playtest:report -- <match-directory>"); process.exitCode = 1; }
  else rebuildReport(args[0]).then(result => console.log(`Report: ${result.file}\nOriginal preserved: ${result.backup}`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
