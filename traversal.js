// Replay witnesses prove existence of routes using the game's real deterministic simulation.
export function validateTraversalPlan(plan) {
  if (plan?.version !== 1 || !Array.isArray(plan.levels) || !plan.levels.length || plan.levels.length > 100) throw new Error("Traversal plan needs version 1 and 1..100 levels.");
  const ids = new Set();
  for (const level of plan.levels) {
    if (typeof level.id !== "string" || !/^[\w-]{1,80}$/.test(level.id) || ids.has(level.id)) throw new Error("Traversal level IDs must be unique identifiers.");
    ids.add(level.id);
    if (!["completion", "accessibility"].includes(level.mode)) throw new Error("Traversal level mode must be completion or accessibility.");
  }
  if (!Array.isArray(plan.seeds) || !plan.seeds.length || plan.seeds.length > 16 || new Set(plan.seeds).size !== plan.seeds.length || plan.seeds.some(s => !Number.isSafeInteger(s) || s < 0)) throw new Error("Traversal seeds must be 1..16 distinct nonnegative integers.");
  return plan;
}

// Self-contained: Playwright serializes this function into the browser.
export function replayTraversal({ expected, maxFrames = 120000 }) {
  const fail = message => { throw new Error(message); };
  const api = window.__gameTest?.traversal;
  if (!api || api.version !== 1 || ["describe", "routes", "reset", "step"].some(name => typeof api[name] !== "function")) fail("Missing __gameTest.traversal v1 API (describe, routes, reset, step). Add real-physics traversal witnesses; startup tests cannot establish reachability.");
  const manifest = api.describe();
  if (!manifest || !Array.isArray(manifest.levels) || !manifest.levels.length || !Array.isArray(manifest.seeds) || !manifest.seeds.length) fail("Traversal manifest must enumerate all levels and supported seeds.");
  const plan = expected || { version: 1, levels: manifest.levels.map(l => ({ id: l.id, mode: l.mode })), seeds: manifest.seeds };
  if (!plan.levels.length || plan.levels.length > 100 || plan.levels.some(l => typeof l.id !== "string" || !["completion", "accessibility"].includes(l.mode))) fail("Invalid traversal level inventory or modes.");
  const ids = new Set(plan.levels.map(l => l.id));
  if (manifest.levels.length !== ids.size || new Set(manifest.levels.map(l => l.id)).size !== ids.size || manifest.levels.some(l => !ids.has(l.id) || plan.levels.find(e => e.id === l.id)?.mode !== l.mode)) fail("Runtime level inventory does not match the design traversal plan.");
  if (manifest.seeds.length !== plan.seeds.length || manifest.seeds.some(s => !plan.seeds.includes(s)) || new Set(manifest.seeds).size !== plan.seeds.length) fail("Runtime seeds do not match the design traversal plan.");
  if (plan.seeds.length > 16 || plan.seeds.some(s => !Number.isSafeInteger(s) || s < 0)) fail("Invalid traversal seeds.");
  if (!Number.isFinite(api.fixedDt) || api.fixedDt < 1 / 240 || api.fixedDt > 1 / 30) fail("Traversal fixedDt must be the real game timestep, between 1/240 and 1/30 seconds.");
  const rect = r => r && ["x", "y", "w", "h"].every(k => typeof r[k] === "number" && Number.isFinite(r[k])) && r.w >= 0 && r.h > 0;
  const inventory = new Map();
  const targets = [];
  for (const level of manifest.levels) {
    if (!Array.isArray(level.surfaces) || !Array.isArray(level.regions) || !level.surfaces.length && !level.regions.length) fail(`Level ${level.id} has no playable surfaces or regions.`);
    const known = new Set();
    for (const [type, entries] of [["surface", level.surfaces], ["region", level.regions]]) for (const entry of entries) {
      if (typeof entry.id !== "string" || !entry.id || known.has(entry.id) || !rect(entry)) fail(`Invalid or duplicate ${type} in ${level.id}.`);
      known.add(entry.id);
      targets.push({ key: `${level.id}/${entry.id}`, levelId: level.id, id: entry.id, type, rect: entry });
    }
    inventory.set(level.id, { surfaces: new Set(level.surfaces.map(s => s.id)), regions: new Set(level.regions.map(r => r.id)) });
  }
  if (targets.length > 2000) fail("Traversal inventory exceeds 2000 targets; split excessive geometry into connected playable surfaces.");
  const routes = api.routes();
  if (!Array.isArray(routes) || !routes.length || routes.length > 64) fail("Provide 1..64 traversal input routes from the real game start.");
  const routeIds = new Set();
  let requestedFrames = 0;
  for (const route of routes) {
    if (typeof route.id !== "string" || !route.id || routeIds.has(route.id) || !plan.seeds.includes(route.seed) || !Array.isArray(route.steps) || !route.steps.length || route.steps.length > 4000) fail("Invalid traversal route identity, seed or steps.");
    routeIds.add(route.id);
    for (const action of route.steps) {
      if (!Number.isSafeInteger(action.frames) || action.frames < 1 || action.frames > 2400 || !Array.isArray(action.keys) || action.keys.length > 12 || action.keys.some(k => typeof k !== "string" || !k || k.length > 40)) fail(`Invalid input action in route ${route.id}; use only {keys, frames}.`);
      if (Object.keys(action).some(k => !["keys", "frames"].includes(k))) fail("Traversal routes cannot teleport, load state, or issue arbitrary code.");
      requestedFrames += action.frames;
    }
  }
  if (requestedFrames > maxFrames) fail(`Traversal routes exceed ${maxFrames} simulation ticks.`);
  const seeds = plan.seeds.map(seed => ({ seed, visited: new Set(), completed: new Set(), routes: [] }));
  const errors = [];
  let simulatedFrames = 0;
  for (const route of routes) {
    const coverage = seeds.find(s => s.seed === route.seed);
    const report = { id: route.id, frames: 0, visited: [], completed: [], recoveries: 0 };
    const routeVisits = new Set(), routeCompletions = new Set();
    let lastTick;
    const observe = snapshot => {
      if (!snapshot || typeof snapshot.then === "function") fail("Traversal reset/step must return a synchronous JSON snapshot.");
      const p = snapshot.player, t = snapshot.traversal;
      if (!rect(p) || p.w <= 0 || typeof p.alive !== "boolean" || typeof p.onGround !== "boolean" || !Number.isSafeInteger(snapshot.tick) || !t || !ids.has(t.levelId) || !Array.isArray(t.completedLevels) || !Number.isSafeInteger(t.recoveries) || t.recoveries < 0 || !Array.isArray(snapshot.surfaces) || !Array.isArray(snapshot.regions)) fail("Traversal snapshots need tick, player {x,y,w,h,alive,onGround}, surfaces, regions, traversal {levelId, completedLevels, recoveries}.");
      if (lastTick !== undefined && snapshot.tick !== lastTick + 1) fail("Traversal step must advance exactly one real physics tick; reset/teleport during replay is forbidden.");
      lastTick = snapshot.tick;
      const surfaces = new Map();
      for (const surface of snapshot.surfaces) {
        if (!rect(surface) || surfaces.has(surface.id) || !inventory.get(t.levelId).surfaces.has(surface.id)) fail(`Unregistered or invalid live surface ${surface.id} in ${t.levelId}. Enumerate all playable collision surfaces.`);
        surfaces.set(surface.id, surface);
      }
      const regions = new Map();
      for (const region of snapshot.regions) {
        if (!rect(region) || regions.has(region.id) || !inventory.get(t.levelId).regions.has(region.id)) fail(`Unregistered or invalid live region ${region.id} in ${t.levelId}.`);
        regions.set(region.id, region);
      }
      if (surfaces.size !== inventory.get(t.levelId).surfaces.size || regions.size !== inventory.get(t.levelId).regions.size) fail(`Live geometry inventory is incomplete in ${t.levelId}. Keep locked/disabled targets with zero width instead of hiding them.`);
      if (t.completedLevels.some(id => !ids.has(id))) fail("Snapshot reports completion of an undeclared level.");
      report.recoveries = Math.max(report.recoveries, t.recoveries);
      report.lastPosition = { levelId: t.levelId, x: p.x, y: p.y, alive: p.alive };
      if (!p.alive) return;
      for (const target of targets) {
        if (target.levelId !== t.levelId) continue;
        const r = target.type === "surface" ? surfaces.get(target.id) : regions.get(target.id);
        if (!r || r.w <= 0) continue;
        const overlapX = p.x + p.w > r.x + 0.5 && p.x < r.x + r.w - 0.5;
        const reached = target.type === "surface" ? p.onGround && overlapX && Math.abs(p.y + p.h - r.y) <= 2 : overlapX && p.y + p.h > r.y && p.y < r.y + r.h;
        if (reached) { coverage.visited.add(target.key); routeVisits.add(target.key); }
      }
      for (const id of t.completedLevels) { coverage.completed.add(id); routeCompletions.add(id); }
    };
    try {
      const initial = api.reset({ seed: route.seed });
      if (initial?.traversal?.completedLevels?.length || initial?.traversal?.recoveries !== 0) fail("Reset must start a fresh game, not a completed level or unlocked checkpoint.");
      observe(initial);
      for (const action of route.steps) for (let frame = 0; frame < action.frames; frame++) {
        observe(api.step({ keys: action.keys }));
        simulatedFrames++; report.frames++;
      }
    } catch (error) { report.error = error.message; errors.push(`Route ${route.id}: ${error.message}`); }
    report.visited = [...routeVisits]; report.completed = [...routeCompletions];
    coverage.routes.push(report);
  }
  const coverage = seeds.map(seed => {
    const missingTargets = targets.filter(t => !seed.visited.has(t.key)).map(t => ({ id: t.key, type: t.type, bounds: t.rect }));
    const missingCompletions = plan.levels.filter(l => l.mode === "completion" && !seed.completed.has(l.id)).map(l => l.id);
    if (missingTargets.length) errors.push(`Seed ${seed.seed}: no replayed route reaches ${missingTargets.map(t => t.id).join(", ")}. Supply a valid route or repair layout/physics; do not remove targets.`);
    if (missingCompletions.length) errors.push(`Seed ${seed.seed}: no successful completion replay for ${missingCompletions.join(", ")}.`);
    return { seed: seed.seed, visited: [...seed.visited], completed: [...seed.completed], missingTargets, missingCompletions, routes: seed.routes };
  });
  return { ok: errors.length === 0, errors, simulatedFrames, targetCount: targets.length, coverage, basis: "replayed input witnesses through shared game physics; coverage of declared playable surfaces/regions and supported seeds" };
}

export async function runTraversal(page, expected) {
  await page.reload({ waitUntil: "load" });
  try { return await page.evaluate(replayTraversal, { expected: expected === true ? undefined : expected }); }
  catch (error) { return { ok: false, errors: [error.message] }; }
}
