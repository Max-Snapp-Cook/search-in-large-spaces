import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import { shellHtml } from "../src/gameRunner.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

async function openShell(t, game = "connect-four.js") {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => errors.push(e.message));
  const dom = new JSDOM(await shellHtml(game), {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole,
    url: pathToFileURL(path.join(fixtures, "index.html")).href,
  });
  t.after(() => dom.window.close());
  await new Promise((resolve) => dom.window.addEventListener("load", resolve, { once: true }));
  return { window: dom.window, errors };
}

test("shell renders the game title, players, and rules", async (t) => {
  const { window, errors } = await openShell(t);
  const $ = (id) => window.document.getElementById(id);
  assert.equal(window.document.title, "Connect Four");
  assert.equal(window.document.querySelectorAll(".chip").length, 2);
  assert.match($("rules").textContent, /four of your discs/);
  assert.equal($("status").textContent, "Red to move");
  assert.deepEqual(errors, []);
});

test("the computer answers a human move", async (t) => {
  const { window } = await openShell(t);
  const shell = window.GameShell;
  shell.configure({ seats: ["human", "random"] });
  assert.equal(shell.play(3), true);
  assert.equal(shell.play(3), false, "out-of-turn moves are ignored");
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(window.GameEngine.currentPlayer(shell.getState()), 1);
  shell.undo();
  assert.equal(shell.getState().board.flat().filter(Boolean).length, 0);
});

test("MCTS takes an immediate win and blocks an immediate loss", async (t) => {
  const { window } = await openShell(t);
  const { GameEngine: engine, GameShell: shell } = window;
  const play = (moves) => moves.reduce((s, m) => engine.applyMove(s, m), engine.initialState());
  // Red has three discs stacked in column 0.
  const redToWin = play([0, 1, 0, 1, 0, 2]);      // Red to move, column 0 wins
  assert.equal(shell.mctsMove(redToWin, 300), 0);
  const yellowMustBlock = play([0, 1, 0, 1, 0]);  // Yellow to move, must block column 0
  assert.equal(shell.mctsMove(yellowMustBlock, 300), 0);
});

test("hot-seat hidden-information games hide other hands behind a pass-the-device screen", async (t) => {
  const { window, errors } = await openShell(t, "crazy-eights.js");
  const $ = (id) => window.document.getElementById(id);
  const shell = window.GameShell;
  shell.configure({ players: 3, seats: ["human", "human", "human"] });
  assert.equal(window.document.querySelectorAll(".chip").length, 3);
  assert.equal($("curtain").classList.contains("up"), true);
  assert.equal(shell.play(window.GameEngine.legalMoves(shell.getState())[0]), false, "no moves behind the curtain");
  shell.reveal();
  assert.equal($("curtain").classList.contains("up"), false);
  // Player 1 sees their own 5 cards face up and 10 opponent cards face down.
  const faceUp = [...$("board").querySelectorAll(".hand svg")].filter((svg) => !svg.innerHTML.includes("gkback"));
  assert.equal(faceUp.length, 5);
  assert.equal(shell.play(window.GameEngine.legalMoves(shell.getState())[0]), true);
  assert.equal($("curtain").classList.contains("up"), true);
  assert.match($("curtain-text").textContent, /East/);
  assert.equal($("log").children.length, 1);
  assert.deepEqual(errors, []);
});

test("the computer never searches on cards it cannot see", async (t) => {
  const { window } = await openShell(t, "crazy-eights.js");
  const { GameEngine: engine, GameShell: shell } = window;
  shell.configure({ players: 2, seats: ["human", "human"] });
  const real = engine.determinize;
  let calls = 0;
  engine.determinize = (state, player) => { calls++; return real(state, player); };
  while (engine.legalMoves(shell.getState()).length < 2) shell.restart();
  const state = shell.getState();
  const move = shell.mctsMove(state, 100);
  assert.ok(calls > 10);
  assert.ok(engine.legalMoves(state).some((m) => JSON.stringify(m) === JSON.stringify(move)));
});

test("the coach is off until toggled, then explains the turn and gives hints", async (t) => {
  const { window, errors } = await openShell(t);
  const $ = (id) => window.document.getElementById(id);
  const shell = window.GameShell;
  shell.configure({ seats: ["human", "human"] });
  assert.equal($("coach").hidden, true);
  assert.equal($("coach-toggle").textContent, "Coach: off");

  $("coach-toggle").click();
  assert.equal($("coach").hidden, false);
  assert.equal($("coach-toggle").getAttribute("aria-pressed"), "true");
  assert.match($("coach-text").textContent, /Click a column/);
  assert.equal($("coach-last").hidden, true);

  // Red has three in column 0; the coach tells Yellow to block, and the hint finds it.
  for (const col of [0, 1, 0, 1, 0]) shell.play(col);
  assert.match($("coach-text").textContent, /Red will win in column 1 next turn unless you block/);
  assert.match($("coach-last").textContent, /Last move: Red dropped a disc in column 1/);
  $("hint").click();
  assert.equal($("hint-text").textContent, "Thinking…");
  for (let waited = 0; $("hint-text").textContent === "Thinking…" && waited < 8000; waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal($("hint-text").textContent, "Suggested: dropped a disc in column 1");
  $("hint-play").click();
  assert.equal(shell.getState().board[3][0], 2, "Play it made the suggested move");
  assert.equal($("hint-text").textContent, "", "an old hint is cleared after a move");

  $("coach-toggle").click();
  assert.equal($("coach").hidden, true);
  assert.deepEqual(errors, []);
});

test("the tutorial teaches the goal, then guides each move, offering only the move it teaches", async (t) => {
  const { window, errors } = await openShell(t);
  const $ = (id) => window.document.getElementById(id);
  const shell = window.GameShell;
  shell.configure({ seats: ["human", "random"] });
  assert.equal($("tutorial").hidden, true);

  $("tutorial-btn").click();
  assert.equal($("tutorial").hidden, false);
  assert.equal($("tutorial-btn").disabled, true);
  assert.match($("tut-progress").textContent, /How the game works/);
  assert.equal($("tut-goal").children.length, 4, "the quick start steps are the first page");
  assert.match($("tut-goal").textContent, /four of your discs in a row/);
  assert.equal($("tut-turn-box").hidden, false, "the first page also explains how a turn works");
  assert.match($("tut-turn").textContent, /Drop a disc — Click any column that still has room/);
  assert.equal($("tut-next").textContent, "Start");
  assert.equal($("undo").disabled, true);
  assert.ok([...$("seats").querySelectorAll("select")].every((sel) => sel.disabled), "seats are locked during the tutorial");

  $("tut-next").click();
  assert.equal($("tut-progress").textContent, "Tutorial · Step 1 of 8");
  assert.match($("tut-text").textContent, /Click the glowing middle column \(column 4\)/);
  assert.equal($("tut-turn-box").hidden, true);
  assert.match($("tut-phases").textContent, /Your turn:Drop a disc/, "shows which part of the turn this is");
  assert.equal($("tut-phases").querySelector(".ph.now").textContent, "Drop a disc");
  assert.equal($("tut-options").hidden, false, "explains what the learner can do on this turn, not just the suggestion");
  assert.match($("tut-how").textContent, /Click any column that still has room/);
  assert.match($("tut-now").textContent, /Build toward four in a row/, "plus the situation, from explainTurn");
  assert.equal($("tut-next").hidden, true);
  assert.equal($("tut-auto").hidden, false);
  assert.equal(shell.play(0), false, "only the taught move is allowed");
  assert.equal(shell.play(3), true);

  // Yellow's move waits for Next, and is then recapped.
  assert.match($("tut-text").textContent, /Yellow drops a disc/);
  assert.match($("tut-next").textContent, /see Yellow's move/);
  assert.match($("tut-phases").textContent, /Yellow's turn:/);
  assert.equal($("tut-options").hidden, true, "options are only listed on the learner's own turn");
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(shell.getState().board.flat().filter(Boolean).length, 1, "the computer does not move on its own");
  $("tut-next").click();
  assert.match($("tut-last").textContent, /Last move: Yellow dropped a disc in column 4/);
  assert.match($("tut-text").textContent, /right on top of yours/);

  for (let i = 0; i < 20 && shell.tutorialPhase === "steps"; i++) $(!$("tut-auto").hidden ? "tut-auto" : "tut-next").click();
  assert.equal(shell.tutorialPhase, "outro");
  assert.match($("tut-text").textContent, /The game ended: Red wins! You win by lining up four/);
  assert.match($("tut-progress").textContent, /How to play \(recap\)/);
  assert.equal($("tut-goal").hidden, false, "the last page repeats the goal...");
  assert.match($("tut-turn").textContent, /Drop a disc/, "...and the parts of a turn as a cheat sheet");
  assert.equal($("tut-keep").hidden, true, "nothing to keep playing after the game ended");
  $("tut-new").click();
  assert.equal($("tutorial").hidden, true);
  assert.deepEqual([...$("seats").querySelectorAll("select")].map((sel) => [sel.value, sel.disabled]), [["human", false], ["random", false]]);
  assert.deepEqual(errors, []);
});

test("Keep playing leaves the tutorial and the computer takes over the other seats", async (t) => {
  const { window, errors } = await openShell(t, "crazy-eights.js");
  const $ = (id) => window.document.getElementById(id);
  const shell = window.GameShell;
  shell.startTutorial();
  shell.tutorialNext();
  for (let i = 0; i < 60 && shell.tutorialPhase !== "outro"; i++) shell.tutorialNext(true);
  assert.equal(shell.tutorialPhase, "outro");
  const moves = shell.getState().moves;
  $("tut-keep").click();
  assert.equal(shell.tutorialPhase, null);
  assert.equal($("tutorial").hidden, true);
  assert.equal(shell.getState().moves, moves, "the game continues from where the tutorial ended");
  assert.deepEqual(errors, []);
});

test("after the script the learner plays one whole turn on their own, with every legal move open", async (t) => {
  const { window, errors } = await openShell(t, "crazy-eights.js");
  const $ = (id) => window.document.getElementById(id);
  const { GameEngine: engine, GameShell: shell } = window;
  // Make the scripted part end mid-game: a single learner move, then the practice turn.
  engine.tutorial = { ...engine.tutorial, steps: engine.tutorial.steps.slice(0, 2) };
  shell.startTutorial();
  shell.tutorialNext();
  shell.tutorialNext(true); // the learner's scripted move
  shell.tutorialNext();     // East's scripted reply
  if (engine.result(shell.getState())) return; // a one-card game can end early; nothing to practise
  assert.equal(shell.tutorialPhase, "practice");
  assert.match($("tut-progress").textContent, /Your turn on your own/);
  assert.match($("tut-text").textContent, /every legal option is open/);
  assert.equal($("tut-options").hidden, false);
  assert.match($("tut-phases").textContent, /Your turn:Play or draw/);
  const state = shell.getState();
  const moves = engine.legalMoves(state);
  assert.equal(shell.play(moves[moves.length - 1]), true, "any legal move is accepted, not just a taught one");
  for (let i = 0; i < 30 && shell.tutorialPhase === "practice"; i++) {
    assert.equal($("tut-next").hidden, false, "East's moves wait for Next");
    shell.tutorialNext();
    if (shell.tutorialPhase === "practice" && engine.currentPlayer(shell.getState()) === 1) {
      shell.play(engine.legalMoves(shell.getState())[0]);
    }
  }
  assert.equal(shell.tutorialPhase, "outro", "the tutorial ends once the learner has played a full turn");
  assert.match($("tut-turn").textContent, /Play or draw — Click a card with the same suit or rank/);
  assert.deepEqual(errors, []);
});

test("games without a tutorial script get a generic three-turn walkthrough", async (t) => {
  const { window, errors } = await openShell(t);
  const $ = (id) => window.document.getElementById(id);
  delete window.GameEngine.tutorial;
  delete window.GameEngine.quickStart;
  delete window.GameEngine.turnPhases;
  const shell = window.GameShell;
  $("tutorial-btn").click();
  assert.match($("tut-goal").textContent, /lowest empty space/, "falls back to the rules text");
  $("tut-next").click();
  assert.equal($("tut-progress").textContent, "Tutorial · Your turn 1 of 3");
  assert.match($("tut-text").textContent, /Your turn\. Suggested move: dropped a disc in column \d/);
  for (let i = 0; i < 20 && shell.tutorialPhase === "steps"; i++) shell.tutorialNext(true);
  assert.equal(shell.getState().board.flat().filter((v) => v === 1).length, 3, "three guided learner moves");
  if (shell.tutorialPhase === "practice") {
    for (let i = 0; i < 10 && shell.tutorialPhase === "practice"; i++) shell.tutorialNext(true);
    assert.equal(shell.getState().board.flat().filter((v) => v === 1).length, 4, "then one turn on their own");
  }
  assert.equal(shell.tutorialPhase, "outro");
  assert.equal($("tut-turn-box").hidden, true, "no turn parts to recap when the game declares none");
  $("tut-exit").click();
  assert.equal(shell.tutorialPhase, null);
  assert.deepEqual(errors, []);
});

test("in hidden games the coach only reads the viewer's own cards", async (t) => {
  const { window, errors } = await openShell(t, "crazy-eights.js");
  const $ = (id) => window.document.getElementById(id);
  const shell = window.GameShell;
  shell.configure({ players: 2, seats: ["human", "mcts"] });
  const real = window.GameEngine.explainTurn;
  const seen = [];
  window.GameEngine.explainTurn = function (state, player) { seen.push(state); return real.call(this, state, player); };
  shell.setCoach(true);
  assert.match($("coach-text").textContent, /Play a card matching|draw a card|pass/);
  assert.ok(seen.length);
  for (const state of seen) assert.ok(state.hands[1].every((c) => c === null), "opponent's hand is hidden");
  assert.deepEqual(errors, []);
});
