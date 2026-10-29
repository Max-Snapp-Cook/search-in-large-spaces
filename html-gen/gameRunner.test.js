import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateGame, repairFeedback, playoutStats } from "./gameRunner.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

// A minimal counting game: players alternately add 1 or 2; whoever reaches 5 wins.
const engine = (overrides = "") => `
window.GameEngine = {
  name: "Race to 5", players: 2, rules: "Add 1 or 2; reach 5 to win.",
  initialState() { return { total: 0, turn: 1 }; },
  currentPlayer(s) { return s.turn; },
  legalMoves(s) { return this.result(s) ? [] : [1, 2]; },
  applyMove(s, m) { return { total: s.total + m, turn: 3 - s.turn }; },
  result(s) { return s.total >= 5 ? { winner: 3 - s.turn } : null; },
  ${overrides}
};`;
const view = (update = "") => `
window.GameView = {
  mount(container, ctx) {
    const root = document.createElement("div");
    container.appendChild(root);
    return {
      update(state, info) {
        ${update}
        root.innerHTML = "";
        for (const m of info.legalMoves) {
          const b = document.createElement("button");
          b.textContent = "+" + m;
          b.addEventListener("click", () => info.canMove && ctx.play(m));
          root.appendChild(b);
        }
      },
    };
  },
};`;

async function validateJs(t, code, options) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "js-game-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "attempt-0.js");
  await fs.writeFile(file, code);
  return validateGame(file, options);
}

test("the fixture games pass validation", async () => {
  for (const file of ["connect-four.js", "crazy-eights.js"]) {
    const result = await validateGame(path.join(fixtures, file), { playouts: 40 });
    assert.equal(result.ok, true, `${file}: ${result.errors.join("\n")}`);
    assert.equal(result.stats.completed, 40);
  }
  const eights = await validateGame(path.join(fixtures, "crazy-eights.js"), { playouts: 4 });
  assert.deepEqual(eights.stats.playerCounts, [2, 4]);
});

// Turns the Crazy Eights fixture into a broken variant by replacing one snippet.
async function brokenEights(t, from, to, options = { playouts: 10 }) {
  const code = await fs.readFile(path.join(fixtures, "crazy-eights.js"), "utf8");
  assert.ok(code.includes(from), from);
  return validateJs(t, code.replace(from, to), options);
}

test("determinize that changes the player's own view is rejected", async (t) => {
  const result = await brokenEights(t, "(i === player - 1 ? h : cards.splice(0, h.length))", "cards.splice(0, h.length)");
  assert.equal(result.stage, "playout");
  assert.match(result.errors[0], /observe\(determinize\(state, p\), p\) must equal observe\(state, p\)/);
});

test("hidden games must define observe and determinize", async (t) => {
  const result = await brokenEights(t, "observe(state, player) {", "notObserve(state, player) {");
  assert.equal(result.stage, "api");
  assert.match(result.errors.join("\n"), /GameEngine\.observe must be a function/);
});

test("Math.random in applyMove is rejected as nondeterministic", async (t) => {
  const result = await brokenEights(t, "moves: state.moves + 1, turn: next(state) };",
    "moves: state.moves + 1, turn: next(state), luck: Math.random() };");
  assert.equal(result.stage, "playout");
  assert.match(result.errors[0], /must be deterministic/);
});

test("errors in evaluate surface before a human meets the computer", async (t) => {
  const result = await brokenEights(t, "const scores = state.hands.map", "const scores = state.handz.map");
  assert.equal(result.stage, "playout");
  assert.match(result.errors[0], /handz|Cannot read/);
});

test("a valid game reports playout stats", async (t) => {
  const result = await validateJs(t, engine() + view(), { playouts: 30 });
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.name, "Race to 5");
  assert.equal(result.stats.completed, 30);
  assert.equal((result.stats.wins[1] ?? 0) + (result.stats.wins[2] ?? 0), 30);
  assert.equal(result.stats.avgBranchingPerState, 2);
});

test("syntax errors fail the load stage with a game.js location", async (t) => {
  const result = await validateJs(t, `${engine()}\nwindow.GameView = {`);
  assert.equal(result.stage, "load");
  assert.match(repairFeedback(result), /SyntaxError/);
});

test("missing GameView fails the api stage", async (t) => {
  const result = await validateJs(t, engine());
  assert.equal(result.stage, "api");
  assert.match(result.errors.join("\n"), /GameView\.mount/);
});

test("rendering errors in later positions fail the ui stage", async (t) => {
  const result = await validateJs(t, engine() + view("if (state.total >= 3) state.board.draw();"));
  assert.equal(result.stage, "ui");
  assert.match(result.errors[0], /attempt-0\.js/);
});

test("errors in click handlers fail the ui stage", async (t) => {
  const code = engine() + view().replace("info.canMove && ctx.play(m)", "brokenHandler()");
  const result = await validateJs(t, code);
  assert.equal(result.stage, "ui");
  assert.match(result.errors[0], /brokenHandler/);
});

test("engine contract violations fail the playout stage", async (t) => {
  const cases = [
    ["applyMove(s, m) { s.total += m; s.turn = 3 - s.turn; return s; },", /mutated its input state/],
    ["legalMoves(s) { return s.total > 2 ? [] : [1, 2]; },", /returned no moves but result\(state\) is null/],
    ["result(s) { return s.total >= 5 ? { winner: 'X' } : null; },", /must be \{ winner: 1\.\.2 \}/],
    ["result(s) { return s.total >= 5 ? { winners: [1, 3] } : null; },", /winners must be an array of player numbers 1\.\.2/],
    ["result(s) { return s.total >= 5 ? { winner: 1, scores: [1] } : null; },", /scores must be an array with one entry per player/],
  ];
  for (const [override, pattern] of cases) {
    // A view that never crashes, so the engine problem surfaces in the playout stage.
    const result = await validateJs(t, engine(override) + view().replace("for (const m of info.legalMoves)", "for (const m of [])"), { playouts: 3 });
    assert.equal(result.stage, "playout", override);
    assert.match(result.errors[0], pattern);
  }
});

test("canvas games load without the native canvas package", async (t) => {
  const canvasView = `
  window.GameView = { mount(container) {
    const canvas = document.createElement("canvas");
    container.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    return { update(state) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 10, 10); ctx.measureText("hi").width + 1; } };
  } };`;
  const result = await validateJs(t, engine() + canvasView, { playouts: 1 });
  assert.equal(result.ok, true, result.errors.join("\n"));
});

test("infinite loops hit the timeout and are repairable", async (t) => {
  const result = await validateJs(t, engine("legalMoves(s) { for (;;) {} },") + view(), { timeoutMs: 3_000 });
  assert.equal(result.stage, "timeout");
  assert.notEqual(repairFeedback(result), null);
});

test("game-tree complexity matches b^d", () => {
  const stats = playoutStats([{ winners: [1], moves: 4, branching: [10, 10, 10, 10] }], 1);
  assert.equal(stats.gameTreeComplexityLog10, 4);
});
