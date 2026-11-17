import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { extractCode, repairUntilPlayable } from "./repairLoop.js";
import { improvementPlanInstructions, improvementCodeInstructions, improvementRepairInstructions } from "./improvePrompts.js";
import { resolveGame, playtestsDirectory, versionLayout, numberedDirectory, createVersion, setVersionStatus } from "./gameStorage.js";

const hash = text => createHash("sha256").update(text).digest("hex");
async function optional(file) {
  try { return await fs.readFile(file, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

export async function loadImprovementInputs(game, reportPaths = [], version) {
  const { gameDir } = await resolveGame(game, version);
  const [code, rules] = await Promise.all([fs.readFile(path.join(gameDir, "game.js"), "utf8"), fs.readFile(path.join(gameDir, "rules.md"), "utf8")]);
  if (!code.trim() || !rules.trim()) throw new Error("Source game.js and rules.md must not be empty");
  const gameSha256 = hash(code), explicit = reportPaths.length > 0;
  if (!explicit) {
    const parent = await playtestsDirectory(gameDir);
    let entries;
    try { entries = await fs.readdir(parent, { withFileTypes: true }); }
    catch (error) { if (error.code !== "ENOENT") throw error; entries = []; }
    reportPaths = entries.filter(e => e.isDirectory()).map(e => path.join(parent, e.name, "report.md")).sort();
  }
  const reports = [], skipped = [], seen = new Set();
  for (const requested of reportPaths) {
    let file = path.resolve(requested);
    try { if ((await fs.stat(file)).isDirectory()) file = path.join(file, "report.md"); }
    catch (error) { if (explicit || error.code !== "ENOENT") throw error; skipped.push({ file, reason: "No report.md" }); continue; }
    const report = await optional(file);
    if (!report?.trim()) {
      if (explicit) throw new Error(`Missing or empty report: ${file}`);
      skipped.push({ file, reason: "Missing or empty report" }); continue;
    }
    file = await fs.realpath(file);
    const reportHash = hash(report);
    if (seen.has(reportHash)) { skipped.push({ file, reason: "Duplicate report content" }); continue; }
    const metadataText = await optional(path.join(path.dirname(file), "metadata.json"));
    const metadata = metadataText ? JSON.parse(metadataText) : {};
    const archived = await optional(path.join(path.dirname(file), "game.js"));
    const hashes = [metadata.gameSha256, archived === null ? null : hash(archived)].filter(Boolean);
    if (hashes.some(value => value !== gameSha256)) {
      if (explicit) throw new Error(`Report belongs to a different game version: ${file}`);
      skipped.push({ file, reason: "Different game version" }); continue;
    }
    seen.add(reportHash);
    reports.push({ id: `report-${reports.length + 1}`, file, sha256: reportHash, text: report,
      provenance: hashes.length ? "verified-source-hash" : "unverified-no-source-hash",
      run: { status: metadata.status ?? "unknown", reason: metadata.reason ?? null,
        result: metadata.result ?? null, feedbackStatus: metadata.feedbackStatus ?? "unknown",
        model: metadata.model ?? null, agentOptions: metadata.agentOptions ?? null } });
  }
  if (!reports.length) throw new Error("No usable playtest reports for this game version. Run a playtest or supply --report <report.md>.");
  return { gameDir, gameSha256, code, rules, reports, skipped };
}

export function parseImprovementPlan(raw, input) {
  let plan;
  try { plan = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { throw new Error("Improvement plan is not valid JSON; see the saved plan response"); }
  const text = value => typeof value === "string" && value.trim().length > 0;
  if (!plan || !text(plan.summary) || !text(plan.rulesMarkdown) || !Array.isArray(plan.changes) || plan.changes.length > 12 ||
    !Array.isArray(plan.deferred) || !plan.deferred.every(text)) throw new Error("Invalid improvement plan shape");
  const ids = new Set(), reports = new Set(input.reports.map(r => r.id));
  for (const change of plan.changes) {
    if (!change || ![change.id, change.title, change.implementation, change.verification].every(text) ||
      !["bug", "clarity", "balance", "agent-interface"].includes(change.kind) || typeof change.changesRules !== "boolean" ||
      !Array.isArray(change.evidence) || !change.evidence.length || change.evidence.some(e => !e || !reports.has(e.report) || !text(e.detail))) {
      throw new Error("Every planned change needs a type, implementation, verification scenario, and valid report evidence");
    }
    if (ids.has(change.id)) throw new Error(`Duplicate change ID: ${change.id}`);
    ids.add(change.id);
  }
  if (!plan.changes.some(c => c.changesRules) && plan.rulesMarkdown !== input.rules) throw new Error("Plan changed rules without declaring a rule change");
  return plan;
}

export async function loadSavedImprovement(fromPlan, game) {
  const resolved = await fs.realpath(path.resolve(fromPlan));
  const planDir = (await fs.stat(resolved)).isDirectory() ? resolved : path.dirname(resolved);
  if (resolved !== planDir && path.basename(resolved) !== "plan.json") throw new Error("--from-plan expects an improvement directory or plan.json (plan.md is the readable summary)");
  const planFile = path.join(planDir, "plan.json");
  const metadata = JSON.parse(await fs.readFile(path.join(planDir, "improvement.json"), "utf8"));
  const [code, rules, rawPlan] = await Promise.all(["inputs/game.js", "inputs/rules.md", "plan.json"].map(file => fs.readFile(path.join(planDir, file), "utf8")));
  if (hash(code) !== metadata.sourceGameSha256) throw new Error("Saved source game does not match the plan's recorded hash");
  if (!Array.isArray(metadata.reports) || !metadata.reports.length) throw new Error("Saved plan has no report provenance");
  const ids = new Set(), reports = [];
  for (const report of metadata.reports) {
    if (!/^report-\d+$/.test(report.id) || ids.has(report.id)) throw new Error("Invalid saved report ID");
    ids.add(report.id);
    const text = await fs.readFile(path.join(planDir, "inputs", `${report.id}.md`), "utf8");
    if (hash(text) !== report.sha256) throw new Error(`Saved ${report.id} does not match its recorded hash`);
    reports.push({ ...report, text });
  }
  let gameDir = metadata.sourceGame;
  if (game) {
    const source = await fs.realpath(path.resolve(game));
    gameDir = (await fs.stat(source)).isDirectory() ? source : path.dirname(source);
    const currentCode = await fs.readFile(path.join(gameDir, "game.js"), "utf8");
    const currentRules = await fs.readFile(path.join(gameDir, "rules.md"), "utf8");
    if (hash(currentCode) !== hash(code) || currentRules !== rules) throw new Error("Selected game has changed since this plan was generated; omit the game path to apply the plan to its saved source snapshot");
  }
  const input = { gameDir, code, rules, gameSha256: hash(code), reports, skipped: [] };
  return { input, plan: parseImprovementPlan(rawPlan, input), planFile, planSha256: hash(rawPlan), outputParent: path.dirname(planDir) };
}

function planMarkdown(plan) {
  return ["# Game improvement plan", "", plan.summary, "",
    "These changes are proposals based on simulated playtests. Validation does not establish improved balance or enjoyment.", "",
    ...plan.changes.flatMap(c => [`## ${c.id}: ${c.title}`, "", `Type: ${c.kind}. Changes rules: ${c.changesRules ? "yes" : "no"}.`, "",
      ...c.evidence.map(e => `- ${e.report}: ${e.detail}`), "", `Implementation: ${c.implementation}`, "", `Verify: ${c.verification}`, ""]),
    "## Deferred / uncertain", "", ...(plan.deferred.length ? plan.deferred.map(item => `- ${item}`) : ["None."]), ""].join("\n");
}

export async function improveGame({ game, version, fromPlan, reports = [], outputParent, request, maxRepairs = 5,
  maxPromptChars = 500_000, planOnly = false, modelInfo = {}, validate, onProgress = console.log }) {
  if (!Number.isSafeInteger(maxRepairs) || maxRepairs < 0) throw new Error("maxRepairs must be a nonnegative integer");
  if (!Number.isSafeInteger(maxPromptChars) || maxPromptChars < 1) throw new Error("maxPromptChars must be a positive integer");
  if (fromPlan && (reports.length || planOnly)) throw new Error("--from-plan cannot be combined with --report or --plan-only");
  const saved = fromPlan ? await loadSavedImprovement(fromPlan, game) : null;
  const input = saved ? saved.input : await loadImprovementInputs(game, reports, version);
  const layout = await versionLayout(input.gameDir);
  const contract = await fs.readFile(new URL("./contract.md", import.meta.url), "utf8");
  const parent = outputParent ? path.resolve(outputParent) : layout ? path.join(layout.projectDir, "plans") : saved?.outputParent ?? path.join(input.gameDir, "improvements");
  const outDir = await numberedDirectory(parent, "plan-");
  let versionDir = null;
  onProgress(`Saving improvement run to ${outDir}`);
  const metadata = { schemaVersion: 1, sourceGame: input.gameDir, sourceGameSha256: input.gameSha256,
    reports: input.reports.map(({ text, ...report }) => report), skippedReports: input.skipped,
    model: modelInfo, startedAt: new Date().toISOString(), status: saved ? "loading_plan" : "planning", maxRepairs, maxPromptChars, planOnly,
    ...(saved ? { fromPlan: saved.planFile, planSha256: saved.planSha256 } : {}) };
  const save = () => fs.writeFile(path.join(outDir, "improvement.json"), JSON.stringify(metadata, null, 2));
  let callNumber = 0;
  async function ask(stage, instructions, data) {
    const prompt = JSON.stringify(data);
    if (prompt.length + instructions.length > maxPromptChars) throw new Error(`${stage} prompt exceeds maxPromptChars=${maxPromptChars}; select fewer reports or increase --max-prompt-chars. No content was truncated.`);
    const prefix = `${String(++callNumber).padStart(2, "0")}-${stage}`;
    onProgress(`Requesting ${stage}...`);
    const start = Date.now();
    let response = "", usage = null, errorText = null;
    const rawFile = path.join(outDir, `${prefix}.response.txt`);
    const streamFile = await fs.open(rawFile, "w");
    try {
      const result = await request({ stage, messages: [{ role: "system", content: instructions }, { role: "user", content: prompt }],
        onChunk: async chunk => { response += chunk; await streamFile.write(chunk); } });
      // Injectable non-streaming clients are also supported.
      if (!response) { response = typeof result === "string" ? result : result.text; await streamFile.write(response); }
      usage = typeof result === "object" ? result.usage ?? null : null;
      return response;
    } catch (error) { errorText = error.message; throw error; }
    finally {
      await streamFile.close();
      await fs.appendFile(path.join(outDir, "requests.jsonl"), JSON.stringify({ stage, elapsedMs: Date.now() - start,
        inputChars: prompt.length + instructions.length, outputChars: response.length, usage, error: errorText, responseFile: path.basename(rawFile) }) + "\n");
    }
  }
  try {
    await save();
    await fs.mkdir(path.join(outDir, "inputs"));
    await Promise.all([fs.writeFile(path.join(outDir, "inputs", "game.js"), input.code), fs.writeFile(path.join(outDir, "inputs", "rules.md"), input.rules),
      ...input.reports.map(r => fs.writeFile(path.join(outDir, "inputs", `${r.id}.md`), r.text))]);
    for (const skipped of input.skipped) onProgress(`Skipped ${skipped.file}: ${skipped.reason}`);
    const plan = saved ? saved.plan : parseImprovementPlan(await ask("plan", improvementPlanInstructions, { rules: input.rules, code: input.code, contract,
      reports: input.reports.map(({ file, sha256, ...report }) => report) }), input);
    await fs.writeFile(path.join(outDir, "plan.json"), JSON.stringify(plan, null, 2));
    await fs.writeFile(path.join(outDir, "plan.md"), planMarkdown(plan));
    await fs.writeFile(path.join(outDir, "rules.md"), plan.rulesMarkdown);
    if (planOnly || !plan.changes.length) {
      metadata.status = planOnly ? "planned" : "no_changes";
      metadata.finishedAt = new Date().toISOString(); await save();
      return { outDir, metadata, plan };
    }
    if (layout) {
      versionDir = await createVersion(layout.projectDir, { kind: "improvement", parentVersion: layout.version, plan: path.relative(layout.projectDir, outDir) });
      metadata.versionDir = versionDir;
      await fs.writeFile(path.join(versionDir, "rules.md"), plan.rulesMarkdown);
      onProgress(`Writing revised game to ${versionDir}`);
    }
    metadata.status = "implementing"; await save();
    const code = extractCode(await ask("implement", improvementCodeInstructions, { code: input.code, rules: plan.rulesMarkdown, plan, contract }));
    metadata.status = "validating"; await save();
    const result = await repairUntilPlayable({ code, rules: plan.rulesMarkdown, examples: "", outDir: versionDir ?? outDir, maxRepairs,
      validationOptions: { requireAgents: true }, ...(validate ? { validate } : {}),
      repair: data => ask("repair", improvementRepairInstructions, { ...data, plan, contract }) });
    metadata.status = "validated";
    metadata.validation = result.validation;
    metadata.outputGameSha256 = hash(await fs.readFile(path.join(versionDir ?? outDir, "game.js"), "utf8"));
    if (versionDir) await setVersionStatus(versionDir, "validated", { gameSha256: metadata.outputGameSha256 });
    metadata.finishedAt = new Date().toISOString(); await save();
    return { outDir, gameDir: versionDir ?? outDir, metadata, plan };
  } catch (error) {
    if (versionDir) await setVersionStatus(versionDir, "failed", { error: error.message });
    metadata.failedStage = metadata.status; metadata.status = "failed"; metadata.error = error.message;
    metadata.finishedAt = new Date().toISOString(); await save();
    throw new Error(`${error.message}\nSaved improvement run: ${outDir}`, { cause: error });
  }
}
