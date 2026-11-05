import { isDeepStrictEqual } from "node:util";
import { validatePlaytests } from "./designContracts.js";

function at(snapshot, path) {
  let value = snapshot;
  for (const key of path.split(".")) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) throw new Error(`Snapshot field missing: ${path}`);
    value = value[key];
  }
  return value;
}
export function assertSnapshot(before, after, step) {
  const actual = at(after, step.path);
  let ok;
  if (step.op === "changed") ok = !isDeepStrictEqual(at(before, step.path), actual);
  else if (step.op === "eq") ok = isDeepStrictEqual(actual, step.value);
  else if (step.op === "ne") ok = !isDeepStrictEqual(actual, step.value);
  else {
    if (typeof actual !== "number" || !Number.isFinite(actual)) throw new Error(`${step.path} must be a finite number.`);
    ok = { gt: () => actual > step.value, gte: () => actual >= step.value, lt: () => actual < step.value, lte: () => actual <= step.value }[step.op]();
  }
  if (!ok) throw new Error(`${step.path}: expected ${step.op} ${step.op === "changed" ? JSON.stringify(at(before, step.path)) : JSON.stringify(step.value)}, observed ${JSON.stringify(actual)}`);
  return { path: step.path, op: step.op, actual, expected: step.op === "changed" ? at(before, step.path) : step.value };
}

// Real DOM keyboard events are used; only virtual time explicitly requested by a
// test advances RAF/timers. Assertions and automation overhead consume no game time.
export async function runPlaytests(sourcePage, tests, { createContext, html }) {
  validatePlaytests(tests);
  const reports = [];
  const readSnapshot = page => page.evaluate(() => {
    if (typeof window.__gameTest?.snapshot !== "function") throw new Error("Missing window.__gameTest.snapshot() testing interface.");
    const state = window.__gameTest.snapshot();
    if (!state || typeof state.tick !== "number" || !state.player || typeof state.player.x !== "number" || typeof state.player.y !== "number") throw new Error("Snapshot must include a real tick counter and player position.");
    return JSON.parse(JSON.stringify(state));
  });
  for (const test of tests) {
    // Playwright's clock is context-wide. A fresh context resets the RAF phase,
    // clock installation, keyboard state and startup
    // timers; previous scenarios cannot change the next scenario's baseline.
    const context = await createContext();
    const page = await context.newPage();
    const snapshot = () => readSnapshot(page);
    const report = { id: test.id, purpose: test.purpose, requirementIds: test.requirementIds, levelId: test.levelId, ok: false, timing: "virtual-clock", checks: [], trace: [], elapsedMs: 0 };
    const held = new Set();
    let index = -1;
    const down = async keys => {
      for (const key of keys) if (!held.has(key)) { await page.keyboard.down(key); held.add(key); }
    };
    const up = async keys => {
      for (const key of keys) if (held.has(key)) { await page.keyboard.up(key); held.delete(key); }
    };
    const advance = async ms => { if (ms) await page.clock.runFor(ms); report.elapsedMs += ms; };
    try {
      // Keep the served origin, but freeze time before executing game scripts.
      // Navigating AFTER clock installation replays timestamped clock commands
      // in a new window and can shift RAF boundaries by one frame.
      const url = sourcePage.url();
      await page.route(url, route => route.fulfill({ status: 200, contentType: "text/html", body: "<!DOCTYPE html><html><head></head><body></body></html>" }));
      await page.goto(url, { waitUntil: "load" });
      await page.unroute(url);
      await page.clock.install({ time: new Date("2020-01-01T00:00:00Z") });
      await page.clock.pauseAt(new Date("2020-01-01T00:00:01Z"));
      await page.setContent(html, { waitUntil: "load" });
      if (test.levelId !== undefined) {
        report.setup = await page.evaluate(levelId => {
          const api = window.__gameTest;
          if (typeof api?.reset !== "function") throw new Error(`Behavior test requests ${levelId}, but __gameTest.reset({levelId}) is missing. This is a behavior fixture, not a traversal shortcut.`);
          api.reset({ levelId });
          const actual = api.snapshot()?.traversal?.levelId;
          if (actual !== levelId) throw new Error(`Behavior level setup failed: requested ${levelId}, observed ${JSON.stringify(actual)}. reset must enter the requested level with its legitimate entry state.`);
          return { requestedLevel: levelId, actualLevel: actual, basis: "isolated behavior fixture; does not establish campaign reachability" };
        }, test.levelId);
      }
      await advance(100);
      report.before = await snapshot();
      if (test.levelId !== undefined && report.before.traversal?.levelId !== test.levelId) throw new Error(`Behavior level changed during initialization: expected ${test.levelId}.`);
      for (index = 0; index < test.steps.length; index++) {
        const step = test.steps[index];
        const entry = { index, step, elapsedMs: report.elapsedMs, heldBefore: [...held], before: await snapshot() };
        report.trace.push(entry);
        const keys = step.keys || (step.key ? [step.key] : []);
        if (step.action === "down") await down(keys);
        else if (step.action === "up") await up(keys);
        else if (step.action === "wait") await advance(step.ms);
        else if (["hold", "press"].includes(step.action)) {
          const temporary = keys.filter(key => !held.has(key));
          await down(keys);
          await advance(step.action === "press" ? 50 : step.ms);
          await up(temporary);
        } else if (step.action === "assert") {
          entry.after = entry.before;
          report.checks.push(assertSnapshot(report.before, entry.after, step));
        }
        entry.after ||= await snapshot();
        entry.heldAfter = [...held];
        entry.elapsedAfterMs = report.elapsedMs;
      }
      report.after = await snapshot();
      report.ok = true;
    } catch (error) {
      report.error = error.message;
      report.failedStep = index >= 0 ? { index, ...test.steps[index] } : { phase: "initialization" };
      try { report.after = await snapshot(); } catch (snapshotError) { report.snapshotError = snapshotError.message; }
      if (report.before && report.after && report.elapsedMs > 100 && report.before.tick === report.after.tick) {
        report.stalled = true;
        report.error += ` No simulation ticks advanced (tick ${report.before.tick}); check title-screen, pause, focus and behavior-reset wiring before changing physics or assertions.`;
      }
    } finally {
      try { await up([...held]); } finally { await context.close(); }
    }
    reports.push(report);
  }
  return reports;
}
