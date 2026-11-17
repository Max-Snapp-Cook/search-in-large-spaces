import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { ensureProject, createVersion, setVersionStatus, resolveGame, numberedDirectory, gameSlug, gameTitle, playtestsDirectory, resolvePlan, readJson } from "./gameStorage.js";
import { organizeGame } from "./organize.js";
import { improveGame, loadImprovementInputs, loadSavedImprovement } from "./improveRunner.js";

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "game-storage-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test("readable safe names, title collisions, and concurrent numbered reservations", async t => {
  const root = await setup(t);
  assert.equal(gameTitle('# **GYRE**\n\nRules'), 'GYRE');
  assert.equal(gameSlug('Café / Board: Game?'), 'cafe-board-game');
  assert.equal(gameSlug('CON'), 'game-con');
  const a = await ensureProject('A/B', root), b = await ensureProject('A B', root);
  assert.notEqual(a, b);
  assert.equal(await ensureProject('A/B', root), a);
  const dirs = await Promise.all(Array.from({ length: 8 }, () => numberedDirectory(path.join(a, 'plans'), 'plan-')));
  assert.equal(new Set(dirs).size, 8);
  assert.ok(dirs.every(d => /plan-\d{3}$/.test(d)));
});
test("latest selects only validated versions; explicit versions and legacy paths work", async t => {
  const root = await setup(t), project = await ensureProject('GYRE', root);
  const first = await createVersion(project); await fs.writeFile(path.join(first, 'game.js'), 'first'); await setVersionStatus(first, 'validated');
  const second = await createVersion(project); await fs.writeFile(path.join(second, 'game.js'), 'failed'); await setVersionStatus(second, 'failed');
  assert.equal((await resolveGame('gyre', undefined, root)).gameDir, first);
  assert.equal((await resolveGame(project, '1')).gameDir, first);
  await assert.rejects(resolveGame(project, 'v002'), /not a validated/);
  await assert.rejects(resolveGame(project, '../v001'), /Version must/);
  assert.equal(await playtestsDirectory(first), path.join(project, 'playtests', 'v001'));
  assert.equal((await resolveGame(path.join(first, 'game.js'))).gameDir, first);
  await assert.rejects(resolveGame('missing', undefined, root), /Game not found/);
});

const makePlan = rules => ({ summary: 'Clarify the interface.', changes: [{ id: 'C1', title: 'Clarify', kind: 'clarity',
  evidence: [{ report: 'report-1', detail: 'Feedback on controls.' }], implementation: 'Update controls', changesRules: false,
  verification: 'Controls are readable.' }], deferred: [], rulesMarkdown: rules });

test("named improvements separate plans and versions and read only source-version reports", async t => {
  const root = await setup(t), project = await ensureProject('GYRE', root), first = await createVersion(project);
  const rules = '# GYRE\nRules.', code = 'source';
  await fs.writeFile(path.join(first, 'game.js'), code); await fs.writeFile(path.join(first, 'rules.md'), rules); await setVersionStatus(first, 'validated');
  const match = await numberedDirectory(await playtestsDirectory(first), 'run-');
  await fs.writeFile(path.join(match, 'report.md'), 'Feedback on controls.'); await fs.writeFile(path.join(match, 'game.js'), code);
  const result = await improveGame({ game: project, onProgress() {}, request: async ({ stage }) => stage === 'plan' ? JSON.stringify(makePlan(rules)) : 'revised', validate: async () => ({ ok: true, errors: [], stage: 'complete' }) });
  assert.equal(result.outDir, path.join(project, 'plans', 'plan-001'));
  assert.equal(result.gameDir, path.join(project, 'versions', 'v002'));
  assert.equal((await resolveGame(project)).gameDir, result.gameDir);
  assert.equal(await fs.readFile(path.join(first, 'game.js'), 'utf8'), code);
  await assert.rejects(fs.access(path.join(result.outDir, 'game.js')));
  await assert.rejects(loadImprovementInputs(project), /No usable/);
  assert.equal((await loadImprovementInputs(project, [], 'v001')).reports.length, 1);
  assert.equal(await resolvePlan('latest', 'gyre', root), result.outDir);
  const saved = await loadSavedImprovement(result.outDir);
  assert.equal(saved.input.gameDir, first);
  await assert.rejects(improveGame({ fromPlan: result.outDir, onProgress() {}, maxRepairs: 0, request: async () => 'bad', validate: async () => ({ ok: false, stage: 'playout', errors: ['bad'] }) }), /repair_limit/);
  assert.equal((await resolveGame(project)).version, 'v002');
});

test("legacy import preserves files and plans, maps lineage, and is repeatable", async t => {
  const root = await setup(t), old = path.join(root, 'legacy'), library = path.join(root, 'outputs');
  await fs.mkdir(old); const rules = '# GYRE\nRules.', code = 'original';
  await fs.writeFile(path.join(old, 'rules.md'), rules); await fs.writeFile(path.join(old, 'game.js'), code);
  await fs.writeFile(path.join(old, 'result.json'), JSON.stringify({ status: 'validated', validation: { name: 'GYRE' } }));
  const match = path.join(old, 'playtests', 'old-run'); await fs.mkdir(match, { recursive: true });
  const report = 'Feedback on controls.'; await fs.writeFile(path.join(match, 'report.md'), report);
  await fs.writeFile(path.join(match, 'game.js'), code);
  const revision = path.join(old, 'improvements', 'old-plan'); await fs.mkdir(path.join(revision, 'inputs'), { recursive: true });
  for (const [name, text] of Object.entries({ 'game.js': code, 'rules.md': rules, 'report-1.md': report })) await fs.writeFile(path.join(revision, 'inputs', name), text);
  await fs.writeFile(path.join(revision, 'plan.json'), JSON.stringify(makePlan(rules)));
  await fs.writeFile(path.join(revision, 'improvement.json'), JSON.stringify({ sourceGame: old, sourceGameSha256: createHash('sha256').update(code).digest('hex'), reports: [{ id: 'report-1', sha256: createHash('sha256').update(report).digest('hex') }] }));
  for (const [name, text] of Object.entries({ 'game.js': 'improved', 'rules.md': rules, 'result.json': JSON.stringify({ status: 'validated' }) })) await fs.writeFile(path.join(revision, name), text);
  const imported = await organizeGame(old, library);
  assert.equal(imported.imported, 2);
  const resolved = await resolveGame('gyre', undefined, library);
  assert.equal(resolved.version, 'v002');
  assert.equal((await loadImprovementInputs(imported.projectDir, [], 'v001')).reports.length, 1);
  const saved = await loadSavedImprovement(path.join(imported.projectDir, 'plans', 'plan-001'));
  assert.equal(saved.input.gameDir, path.join(imported.projectDir, 'versions', 'v001'));
  assert.equal(await fs.readFile(path.join(old, 'game.js'), 'utf8'), code);
  assert.equal((await organizeGame(old, library)).imported, 0);
  assert.equal((await fs.readdir(path.join(imported.projectDir, 'versions'))).length, 2);
  const second = path.join(old, 'playtests', 'new-run'); await fs.mkdir(second); await fs.writeFile(path.join(second, 'report.md'), 'New feedback');
  await organizeGame(old, library);
  assert.equal((await fs.readdir(path.join(imported.projectDir, 'playtests', 'v001'))).length, 2);
  assert.equal((await readJson(path.join(resolved.gameDir, 'version.json'))).importedFrom, revision);
});
