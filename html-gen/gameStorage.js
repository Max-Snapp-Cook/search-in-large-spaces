import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const outputsRoot = fileURLToPath(new URL("./outputs/", import.meta.url));
export async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
export async function exists(file) {
  try { await fs.access(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}
export const writeJson = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2));
export function gameTitle(rules, fallback = "Untitled Game") {
  const title = rules.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1];
  return title?.replace(/[*_`]/g, "").trim() || fallback;
}
export function gameSlug(name) {
  let slug = name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 70).replace(/-+$/, "") || "untitled-game";
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(slug)) slug = `game-${slug}`;
  return slug;
}

// Same game title shares a project. Different titles with colliding slugs get a suffix.
export async function ensureProject(name, root = outputsRoot) {
  await fs.mkdir(root, { recursive: true });
  for (let n = 1; ; n++) {
    const slug = `${gameSlug(name)}${n === 1 ? "" : `-${n}`}`, dir = path.join(root, slug);
    try {
      await fs.mkdir(dir);
      await writeJson(path.join(dir, "project.json"), { schemaVersion: 1, name, slug });
      return dir;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const project = await readJson(path.join(dir, "project.json"));
      if (project?.name.normalize("NFKC").toLowerCase() === name.normalize("NFKC").toLowerCase()) return dir;
    }
  }
}

// mkdir is the reservation, so simultaneous runs cannot overwrite one another.
export async function numberedDirectory(parent, prefix) {
  await fs.mkdir(parent, { recursive: true });
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  const numbers = (await fs.readdir(parent)).map(name => Number(name.match(pattern)?.[1] || 0));
  for (let n = Math.max(0, ...numbers) + 1; ; n++) {
    const dir = path.join(parent, `${prefix}${String(n).padStart(3, "0")}`);
    try { await fs.mkdir(dir); return dir; }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
}

export async function versionLayout(dir) {
  const version = path.basename(dir), versions = path.dirname(dir), projectDir = path.dirname(versions);
  if (!/^v\d+$/.test(version) || path.basename(versions) !== "versions") return null;
  const project = await readJson(path.join(projectDir, "project.json"));
  return project ? { projectDir, project, version, gameDir: dir } : null;
}

export async function createVersion(projectDir, details = {}) {
  const gameDir = await numberedDirectory(path.join(projectDir, "versions"), "v");
  await writeJson(path.join(gameDir, "version.json"), { schemaVersion: 1, createdAt: new Date().toISOString(), status: "generating", ...details });
  return gameDir;
}
export async function setVersionStatus(gameDir, status, details = {}) {
  const file = path.join(gameDir, "version.json");
  await writeJson(file, { ...await readJson(file), ...details, status });
}

export async function resolveGame(reference, version, root = outputsRoot) {
  let target = path.resolve(reference);
  if (!await exists(target)) {
    // Only a plain game name may resolve under the library; never reinterpret missing file paths.
    if (/[\\/]/.test(reference)) throw new Error(`Game not found: ${reference}`);
    target = path.join(root, gameSlug(reference));
  }
  if (!await exists(target)) throw new Error(`Game not found: ${reference}. Use a game name under outputs or an existing game path.`);
  if (!(await fs.stat(target)).isDirectory()) target = path.dirname(target);
  const project = await readJson(path.join(target, "project.json"));
  if (project) {
    let selected;
    if (version && version !== "latest") {
      if (!/^(?:v)?[1-9]\d*$|^v0*[1-9]\d*$/.test(version)) throw new Error("Version must be latest, v001, v002, etc.");
      selected = `v${String(Number(version.replace(/^v/, ""))).padStart(3, "0")}`;
    } else {
      const versions = await fs.readdir(path.join(target, "versions")).catch(error => { if (error.code === "ENOENT") return []; throw error; });
      for (const candidate of versions.filter(v => /^v\d+$/.test(v)).sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)))) {
        const info = await readJson(path.join(target, "versions", candidate, "version.json"));
        if (info?.status === "validated" && await exists(path.join(target, "versions", candidate, "game.js"))) { selected = candidate; break; }
      }
    }
    if (!selected) throw new Error(`No validated version of ${project.name} is available yet`);
    const dir = path.join(target, "versions", selected);
    if ((await readJson(path.join(dir, "version.json")))?.status !== "validated" || !await exists(path.join(dir, "game.js"))) throw new Error(`${selected} is not a validated playable version`);
    return { gameDir: dir, gameFile: path.join(dir, "game.js"), ...await versionLayout(dir) };
  }
  const layout = await versionLayout(target);
  if (version) {
    if (!layout) throw new Error("--version requires a named game project");
    return resolveGame(layout.projectDir, version, root);
  }
  if (!await exists(path.join(target, "game.js"))) throw new Error(`No game.js in ${target}`);
  return { gameDir: target, gameFile: path.join(target, "game.js"), ...layout };
}

export async function playtestsDirectory(gameDir) {
  const layout = await versionLayout(gameDir);
  return layout ? path.join(layout.projectDir, "playtests", layout.version) : path.join(gameDir, "playtests");
}

export async function resolvePlan(reference, gameReference, root = outputsRoot) {
  if (await exists(path.resolve(reference))) return path.resolve(reference);
  if (!gameReference || !/^(latest|plan-\d+)$/.test(reference)) throw new Error("Supply a plan path, or use a game name with --from-plan latest/plan-001");
  let projectDir = path.resolve(gameReference);
  if (!await readJson(path.join(projectDir, "project.json"))) {
    if (!/[\\/]/.test(gameReference)) projectDir = path.join(root, gameSlug(gameReference));
    else projectDir = (await versionLayout(projectDir))?.projectDir ?? projectDir;
  }
  if (!await readJson(path.join(projectDir, "project.json"))) throw new Error("Named plan selection requires a game project");
  const plans = path.join(projectDir, "plans");
  if (reference !== "latest") return path.join(plans, reference);
  const entries = await fs.readdir(plans);
  for (const entry of entries.filter(n => /^plan-\d+$/.test(n)).sort((a, b) => Number(b.slice(5)) - Number(a.slice(5)))) {
    if (await exists(path.join(plans, entry, "plan.json"))) return path.join(plans, entry);
  }
  throw new Error("No saved plan is available for this game");
}
