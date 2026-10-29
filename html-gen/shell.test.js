import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import { shellHtml } from "./gameRunner.js";

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
