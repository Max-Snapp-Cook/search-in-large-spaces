// Import legacy outputs by copying them; old paths and archived replays remain usable.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { outputsRoot, exists, readJson, writeJson, gameTitle, ensureProject, createVersion, setVersionStatus, numberedDirectory } from "./gameStorage.js";

async function directories(dir) {
  try { return (await fs.readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => path.join(dir, e.name)).sort(); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}
async function copyFiles(source, dest, select = () => true) {
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    if (entry.isFile() && select(entry.name)) await fs.copyFile(path.join(source, entry.name), path.join(dest, entry.name));
  }
}

export async function organizeGame(source, root = outputsRoot) {
  source = await fs.realpath(path.resolve(source));
  if (await exists(path.join(source, "project.json"))) return { projectDir: source, imported: 0 };
  const rules = await fs.readFile(path.join(source, "rules.md"), "utf8");
  const result = await readJson(path.join(source, "result.json"));
  const projectDir = await ensureProject(result?.validation?.name || gameTitle(rules), root);
  const manifestFile = path.join(projectDir, "imports.json");
  const manifest = await readJson(manifestFile) || { sources: {} };
  manifest.matches ??= {};
  let imported = 0;
  async function visit(oldDir) {
    if (manifest.sources[oldDir]) return;
    const isPlan = await exists(path.join(oldDir, "improvement.json"));
    const hasCode = await exists(path.join(oldDir, "game.js"));
    let planDir = null, versionDir = null;
    if (isPlan) {
      planDir = await numberedDirectory(path.join(projectDir, "plans"), "plan-");
      await copyFiles(oldDir, planDir, n => !["game.js", "index.html", "result.json"].includes(n) && !/^attempt-\d+\.(js|json)$/.test(n));
      if (await exists(path.join(oldDir, "inputs"))) await fs.cp(path.join(oldDir, "inputs"), path.join(planDir, "inputs"), { recursive: true, errorOnExist: true, force: false });
    }
    if (hasCode || !isPlan) {
      versionDir = await createVersion(projectDir, { importedFrom: oldDir, ...(planDir ? { plan: path.relative(projectDir, planDir) } : {}) });
      await copyFiles(oldDir, versionDir, n => !isPlan || ["game.js", "index.html", "rules.md", "result.json"].includes(n) || /^attempt-\d+\.(js|json)$/.test(n));
      const validation = await readJson(path.join(oldDir, "result.json"));
      await setVersionStatus(versionDir, hasCode && validation?.status === "validated" ? "validated" : "failed");
      if (validation?.lastAttempt) await writeJson(path.join(versionDir, "result.json"), { ...validation, lastAttempt: path.join(versionDir, path.basename(validation.lastAttempt)) });
    }
    manifest.sources[oldDir] = { versionDir, planDir };
    imported++;
    await writeJson(manifestFile, manifest);
  }
  // Revisit descendants even when a previous import already copied the parent.
  async function walk(dir) {
    await visit(dir);
    const { versionDir } = manifest.sources[dir];
    if (versionDir) for (const match of await directories(path.join(dir, "playtests"))) {
      if (manifest.matches[match]) continue;
      const run = await numberedDirectory(path.join(projectDir, "playtests", path.basename(versionDir)), "run-");
      await copyFiles(match, run);
      const meta = await readJson(path.join(run, "metadata.json"));
      if (meta) await writeJson(path.join(run, "metadata.json"), { ...meta, gameFile: path.join(versionDir, "game.js"), importedFrom: match });
      manifest.matches[match] = run;
      await writeJson(manifestFile, manifest);
    }
    for (const child of await directories(path.join(dir, "improvements"))) await walk(child);
  }
  await walk(source);
  for (const { planDir, versionDir } of Object.values(manifest.sources)) {
    if (!planDir) continue;
    const meta = await readJson(path.join(planDir, "improvement.json"));
    const mapped = manifest.sources[meta.sourceGame];
    if (mapped?.versionDir) meta.sourceGame = mapped.versionDir;
    if (meta.fromPlan) {
      const old = manifest.sources[path.dirname(meta.fromPlan)];
      if (old?.planDir) meta.fromPlan = path.join(old.planDir, "plan.json");
    }
    if (versionDir) meta.versionDir = versionDir;
    await writeJson(path.join(planDir, "improvement.json"), meta);
  }
  return { projectDir, imported };
}

export async function main(args = process.argv.slice(2)) {
  if (args.length !== 1 || args[0] === "--help") {
    console.log("Usage: npm run organize -- <legacy-game-directory | --all>\nCopies old games into named projects with versions, plans, and playtests. Originals remain intact.");
    if (args[0] !== "--help") throw new Error("Supply one legacy game directory or --all");
    return;
  }
  const sources = args[0] === "--all" ? (await directories(outputsRoot)).filter(dir => /^\d{4}-\d\d-\d\dT/.test(path.basename(dir))) : [args[0]];
  for (const source of sources) {
    if (!await exists(path.join(source, "rules.md"))) continue;
    const result = await organizeGame(source);
    console.log(`${source} -> ${result.projectDir} (${result.imported} new entries)`);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
