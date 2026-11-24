import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateGame, repairFeedback, playoutStats } from "../src/gameRunner.js";

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
  quickStart: ["Reach a total of 5 to win.", "On your turn add 1 or 2."],
  describeMove(s, m) { return "added " + m; },
  explainTurn(s, p) { return "The total is " + s.total + ". Add 1 or 2."; },
  turnPhases: [{ id: "add", name: "Add", how: "Click +1 or +2 to add to the total." }],
  turnPhase() { return "add"; },
  tutorial: {
    steps: [
      { choose: (s, moves) => moves[0], say: () => "Click +1 to add one." },
      { choose: (s, moves) => moves[0], say: () => "Your opponent adds one. Press Next." },
      { choose: (s, moves) => moves[0], say: () => "Click +1 again." },
      { choose: (s, moves) => moves[0], say: () => "Their turn. Press Next." },
      { choose: (s, moves) => moves[0], say: () => "Click +1 once more." },
    ],
    outro: "Reach 5 to win.",
  },
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

test("games must provide the tutorial text: quickStart, describeMove, explainTurn", async (t) => {
  const missing = await validateJs(t, engine().replace(/  explainTurn.*\n/, "").replace(/  quickStart.*\n/, "") + view());
  assert.equal(missing.stage, "api");
  assert.match(missing.errors.join("\n"), /explainTurn\(state, player\) must be a function/);
  assert.match(missing.errors.join("\n"), /quickStart must be an array of 3 to 5 short strings/);

  const empty = await validateJs(t, engine().replace('return "The total is " + s.total + ". Add 1 or 2.";',
    'return s.total > 2 ? "" : "Add 1 or 2.";') + view(), { playouts: 5 });
  assert.equal(empty.stage, "playout");
  assert.match(empty.errors[0], /explainTurn\(state, \d\) must return one or two sentences/);

  const blank = await validateJs(t, engine().replace('return "added " + m;', 'return "";') + view(), { playouts: 5 });
  assert.equal(blank.stage, "playout");
  assert.match(blank.errors[0], /describeMove\(state, \d\) must return a non-empty string/);
});

test("tutorial scripts are replayed and must teach at least 3 legal learner moves", async (t) => {
  const missing = await validateJs(t, engine().replace(/  tutorial: \{[\s\S]*?\n  \},\n/, "") + view());
  assert.equal(missing.stage, "api");
  assert.match(missing.errors.join("\n"), /GameEngine\.tutorial must be/);

  const illegal = await validateJs(t, engine().replace('{ choose: (s, moves) => moves[0], say: () => "Click +1 again." }',
    '{ choose: () => 7, say: () => "Click +7." }') + view());
  assert.equal(illegal.stage, "playout");
  assert.match(illegal.errors[0], /tutorial\.steps\[2\].*choose returned 7, which is not a legal move/);

  const short = await validateJs(t, engine().replace('{ choose: (s, moves) => moves[0], say: () => "Click +1 once more." }',
    '{ say: () => "That is all." }') + view());
  assert.equal(short.stage, "playout");
  assert.match(short.errors[0], /only has player 1 make 2 move/);

  const silent = await validateJs(t, engine().replace('say: () => "Click +1 to add one."', 'say: () => ""') + view());
  assert.equal(silent.stage, "playout");
  assert.match(silent.errors[0], /tutorial\.steps\[0\].*say\(state, move\) must return/);
});

test("games must name the parts of a turn, and the tutorial must walk the learner through each one", async (t) => {
  const missing = await validateJs(t, engine().replace(/  turnPhases.*\n/, "").replace(/  turnPhase\(.*\n/, "") + view());
  assert.equal(missing.stage, "api");
  assert.match(missing.errors.join("\n"), /turnPhases must be an array of 1 to 8 parts of a turn/);
  assert.match(missing.errors.join("\n"), /turnPhase\(state\) must be a function/);

  const unknown = await validateJs(t, engine('turnPhase() { return "roll"; },') + view(), { playouts: 2 });
  assert.equal(unknown.stage, "playout");
  assert.match(unknown.errors[0], /turnPhase\(state\) returned "roll", which is not an id in turnPhases/);

  // A second part the script never reaches (the game is made long enough not to end during the tutorial).
  const parts = 'turnPhases: [{ id: "add", name: "Add", how: "Click +1 or +2." }, { id: "bonus", name: "Bonus", how: "Click Bonus." }],';
  const long = 'result(s) { return s.total >= 40 ? { winner: 3 - s.turn } : null; },';
  const skipped = await validateJs(t, engine(parts + long) + view(), { playouts: 2 });
  assert.equal(skipped.stage, "playout");
  assert.match(skipped.errors[0], /never has player 1 make a move in these parts of a turn: "Bonus" \(bonus\)/);

  const sometimes = await validateJs(t, engine(parts.replace('how: "Click Bonus." }', 'how: "Click Bonus.", sometimes: true }') + long) + view(),
    { playouts: 2 });
  assert.equal(sometimes.ok, true, sometimes.errors?.join("\n"));
});

test("explainTurn in hidden games only receives what the player can see", async (t) => {
  const result = await brokenEights(t, "const t = top(state);\n      const rank",
    "if (state.deck.some((c) => c !== null)) throw new Error('saw the deck');\n      const t = top(state);\n      const rank");
  assert.equal(result.ok, true, result.errors.join("\n"));
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
