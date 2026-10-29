// gameRunner.js
// Validates a generated game.js headlessly (jsdom): loads it inside the real shell page,
// checks the GameEngine/GameView contract, drives the UI, and runs random playouts.
// Validation runs in a child process so infinite loops in the game hit a timeout.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const runnerFile = fileURLToPath(import.meta.url);
export const shellFile = path.join(path.dirname(runnerFile), "shell", "index.html");
const failure = (stage, message, diagnostics = "") => ({
  ok: false, stage, errors: [message], stats: null, diagnostics,
});

export function parseChildResult({ error, stdout, stderr }, timeoutMs) {
  if (error?.killed) {
    return failure("timeout", `Validation did not finish within ${timeoutMs / 1000}s. ` +
      "Look for infinite loops in legalMoves/applyMove/result or in the UI code.", stderr);
  }
  try {
    const result = JSON.parse(stdout.trim());
    if (typeof result.ok !== "boolean" || typeof result.stage !== "string" || !Array.isArray(result.errors)) {
      throw new Error("Unexpected validator response shape");
    }
    return result;
  } catch {
    return failure("process", "The validator did not return a valid result.", `${stderr}\n${stdout}`.trim());
  }
}

export async function validateGame(file, { playouts = 20, maxMoves = 1000, timeoutMs = 60_000 } = {}) {
  if (!Number.isSafeInteger(playouts) || playouts < 0 ||
      !Number.isSafeInteger(maxMoves) || maxMoves < 1 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    return failure("input", "playouts must be a nonnegative integer; maxMoves and timeoutMs must be positive integers.");
  }
  if (typeof file !== "string" || !file) return failure("input", "Provide a game .js file path.");
  const gameFile = path.resolve(file);
  try { await fs.access(gameFile); }
  catch { return failure("input", `Game file not found: ${gameFile}`); }
  return new Promise((resolve) => {
    execFile(process.execPath, [runnerFile, "--child", gameFile, String(playouts), String(maxMoves)], {
      timeout: timeoutMs, windowsHide: true, encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
    }, (error, stdout, stderr) => resolve(parseChildResult({ error, stdout, stderr }, timeoutMs)));
  });
}

// Only these stages describe game bugs that an LLM should try to fix.
export function repairFeedback(result) {
  if (result.ok || !["load", "api", "playout", "ui", "ai", "timeout"].includes(result.stage)) return null;
  return [`The game failed during ${result.stage}.`, ...result.errors, result.diagnostics || ""].join("\n").slice(0, 20_000);
}

// ---------------------------------------------------------------------------
// Child-process side: everything below runs inside the validator process.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Any property, call, or construction returns the stub itself, so canvas drawing
// code runs without the native canvas package.
function canvasStub() {
  const stub = new Proxy(function () {}, {
    get: (_, key) => key === Symbol.toPrimitive ? () => 0 : key === "then" ? undefined : stub,
    set: () => true,
    apply: () => stub,
    construct: () => stub,
  });
  return stub;
}

function describe(error) {
  const stack = error?.stack?.split("\n").filter((line) => line.trim()).slice(0, 4).join("\n");
  if (!stack) return String(error);
  // SyntaxError stacks start with the location and can omit the message.
  const headline = `${error.name}: ${error.message}`;
  return stack.includes(headline) ? stack : `${headline}\n${stack}`;
}

const json = (value) => JSON.stringify(value);

export function playerCounts(engine) {
  const min = engine.minPlayers ?? engine.players, max = engine.maxPlayers ?? engine.players;
  return [...new Set([min, engine.players ?? min, max])].sort((a, b) => a - b);
}

function checkEngine(engine, window) {
  const problems = [];
  if (!engine || typeof engine !== "object") return ["window.GameEngine is not defined. Assign the engine object to window.GameEngine."];
  if (typeof window.GameView?.mount !== "function") problems.push("window.GameView.mount(container, ctx) must be a function.");
  for (const fn of ["initialState", "currentPlayer", "legalMoves", "applyMove", "result"]) {
    if (typeof engine[fn] !== "function") problems.push(`GameEngine.${fn} must be a function.`);
  }
  if (engine.hidden) {
    for (const fn of ["observe", "determinize"]) {
      if (typeof engine[fn] !== "function") problems.push(`GameEngine.hidden is true, so GameEngine.${fn} must be a function.`);
    }
  }
  for (const fn of ["evaluate", "describeMove"]) {
    if (engine[fn] !== undefined && typeof engine[fn] !== "function") problems.push(`GameEngine.${fn} must be a function if defined.`);
  }
  if (typeof engine.name !== "string" || !engine.name) problems.push("GameEngine.name must be a non-empty string.");
  const min = engine.minPlayers ?? engine.players, max = engine.maxPlayers ?? engine.players;
  if (!Number.isSafeInteger(engine.players) || !Number.isSafeInteger(min) || !Number.isSafeInteger(max) ||
      min < 1 || min > engine.players || engine.players > max) {
    problems.push("GameEngine.players (default count) must be an integer, with optional minPlayers <= players <= maxPlayers.");
  }
  return problems;
}

// Throws a descriptive error when the engine breaks its contract; returns the winners.
function checkResult(res, players) {
  if (res === null || res === undefined) return null;
  if (typeof res !== "object") throw new Error(`result(state) must return null or { winner } / { winners }, got ${json(res)}.`);
  const valid = (p) => Number.isSafeInteger(p) && p >= 1 && p <= players;
  if (res.scores !== undefined && (!Array.isArray(res.scores) || res.scores.length !== players)) {
    throw new Error(`result(state).scores must be an array with one entry per player (${players}), got ${json(res.scores)}.`);
  }
  if (res.winners !== undefined) {
    if (!Array.isArray(res.winners) || !res.winners.every(valid)) {
      throw new Error(`result(state).winners must be an array of player numbers 1..${players}, got ${json(res.winners)}.`);
    }
    return res.winners;
  }
  if (res.winner === null) return [];
  if (!valid(res.winner)) {
    throw new Error(`result(state) must be { winner: 1..${players} }, { winner: null } for a draw, or { winners: [...] }, got ${json(res)}.`);
  }
  return [res.winner];
}

const sortedKeys = (moves) => moves.map(json).sort().join("|");

// Hidden-information checks: determinize may only change what the player cannot see.
function checkHidden(engine, state, player) {
  const before = json(state);
  const seen = json(engine.observe(state, player));
  if (seen === undefined) throw new Error("observe(state, player) must return a JSON-serializable state.");
  const resampled = engine.determinize(state, player);
  if (json(state) !== before) throw new Error("observe/determinize mutated their input state. Return new objects instead.");
  if (!resampled || json(resampled) === undefined) throw new Error("determinize(state, player) must return a JSON-serializable state.");
  if (json(engine.observe(resampled, player)) !== seen) {
    throw new Error(`determinize(state, ${player}) changed information player ${player} can see: ` +
      "observe(determinize(state, p), p) must equal observe(state, p). Only reshuffle hidden cards/tiles and the RNG seed.");
  }
  if (engine.currentPlayer(state) === player && sortedKeys(engine.legalMoves(resampled)) !== sortedKeys(engine.legalMoves(state))) {
    throw new Error(`determinize(state, ${player}) changed player ${player}'s legal moves; it must keep everything they know.`);
  }
}

function playout(engine, players, maxMoves) {
  const history = [];
  const branching = [];
  let state = engine.initialState(players);
  try {
    if (!state || json(state) === undefined) throw new Error("initialState(numPlayers) must return a JSON-serializable object.");
    for (;;) {
      const winners = checkResult(engine.result(state), players);
      if (winners) return { winners, moves: history.length, branching };
      if (history.length >= maxMoves) return { moveLimit: true, moves: history.length, branching };
      const player = engine.currentPlayer(state);
      if (!Number.isSafeInteger(player) || player < 1 || player > players) {
        throw new Error(`currentPlayer(state) must return 1..${players} in a ${players}-player game, got ${json(player)}.`);
      }
      const moves = engine.legalMoves(state);
      if (!Array.isArray(moves)) throw new Error("legalMoves(state) must return an array.");
      if (moves.length === 0) {
        throw new Error("legalMoves(state) returned no moves but result(state) is null. " +
          "Either end the game in result() or offer a pass move.");
      }
      if (engine.hidden && history.length % 3 === 0) checkHidden(engine, state, player);
      if (engine.evaluate && history.length % 10 === 0) {
        const values = engine.evaluate(state);
        if (!Array.isArray(values) || values.length !== players || !values.every((v) => typeof v === "number" && v >= 0 && v <= 1)) {
          throw new Error(`evaluate(state) must return ${players} numbers between 0 and 1, got ${json(values)}.`);
        }
      }
      branching.push(moves.length);
      const move = moves[Math.floor(Math.random() * moves.length)];
      if (json(move) === undefined) throw new Error(`Moves must be JSON-serializable, got ${String(move)}.`);
      if (engine.describeMove && typeof engine.describeMove(state, move) !== "string") {
        throw new Error("describeMove(state, move) must return a string.");
      }
      const before = json(state);
      const next = engine.applyMove(state, move);
      history.push(move);
      if (json(state) !== before) throw new Error("applyMove(state, move) mutated its input state. Return a new state instead.");
      if (!next || typeof next !== "object" || json(next) === undefined) {
        throw new Error("applyMove(state, move) must return a new JSON-serializable state object.");
      }
      if (json(engine.applyMove(state, move)) !== json(next)) {
        throw new Error("applyMove(state, move) must be deterministic. Keep the RNG seed in the state and use " +
          "GameKit.random/randInt/shuffle/rollDice instead of Math.random.");
      }
      state = next;
    }
  } catch (error) {
    const recent = history.slice(-30).map(json).join(", ");
    throw new Error(`${describe(error)}\nIn a ${players}-player game after ${history.length} random moves (last moves: ${recent || "none"}).`);
  }
}

export function playoutStats(results, requested, counts = []) {
  const finished = results.filter((r) => !r.moveLimit);
  const wins = {};
  for (const r of finished) for (const w of r.winners) wins[w] = (wins[w] ?? 0) + 1;
  const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  const perTrial = results.filter((r) => r.branching.length).map((r) => mean(r.branching));
  const avgMoves = mean(results.map((r) => r.moves));
  const avgBranchingPerTrial = mean(perTrial);
  return {
    playouts: requested,
    playerCounts: counts,
    completed: finished.length,
    wins,
    draws: finished.filter((r) => r.winners.length === 0).length,
    sharedWins: finished.filter((r) => r.winners.length > 1).length,
    moveLimitReached: results.length - finished.length,
    avgMoves,
    avgBranchingPerTrial,
    avgBranchingPerState: mean(results.flatMap((r) => r.branching)),
    // Estimated game-tree size b^d from average branching factor b and game length d.
    gameTreeComplexityLog10: avgBranchingPerTrial > 0 ? avgMoves * Math.log10(avgBranchingPerTrial) : 0,
  };
}

// Builds the page the browser sees: the shell with its <script src="game.js"> pointing at gameSrc.
export async function shellHtml(gameSrc = "game.js") {
  const html = await fs.readFile(shellFile, "utf8");
  if (!html.includes('<script src="game.js"></script>')) throw new Error(`${shellFile} must load game.js`);
  return html.replace('<script src="game.js"></script>', `<script src="${encodeURI(gameSrc)}"></script>`);
}

export async function checkGame(gameFile, { playouts, maxMoves }) {
  const { JSDOM, VirtualConsole } = await import("jsdom");
  const scriptErrors = [];
  const notes = [];
  const fail = (stage, errors) => ({
    ok: false, stage, errors: [...new Set(errors)].slice(0, 10), stats: null, diagnostics: notes.join("\n").slice(0, 5_000),
  });

  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => {
    if (error.type === "unhandled-exception") scriptErrors.push(describe(error.cause ?? error));
    else if (error.type === "resource-loading") scriptErrors.push(error.message);
    else notes.push(error.message);
  });
  virtualConsole.on("error", (...args) => notes.push(`console.error: ${args.join(" ")}`));

  // The page sits next to game.js, like the published index.html does.
  const dom = new JSDOM(await shellHtml(path.basename(gameFile)), {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole,
    url: pathToFileURL(path.join(path.dirname(gameFile), "index.html")).href,
    beforeParse(window) {
      window.HTMLCanvasElement.prototype.getContext = () => canvasStub();
      window.alert = (message) => notes.push(`alert: ${message}`);
      window.confirm = () => true;
      window.prompt = () => null;
    },
  });
  const { window } = dom;
  const random = (xs) => xs[Math.floor(Math.random() * xs.length)];
  const clickEverything = () => {
    for (const el of [...window.document.querySelectorAll("#board *")].slice(0, 400)) {
      if (!el.isConnected) continue; // removed by an earlier click's re-render
      el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    }
  };
  try {
    if (window.document.readyState !== "complete") {
      await new Promise((resolve) => window.addEventListener("load", resolve, { once: true }));
    }
    await sleep(200);
    const engine = window.GameEngine;
    const apiProblems = checkEngine(engine, window);
    // A missing engine usually means game.js crashed; otherwise contract problems are the root cause.
    if (scriptErrors.length && !engine) return fail("load", scriptErrors);
    if (apiProblems.length) return fail("api", apiProblems);
    if (scriptErrors.length) return fail("load", scriptErrors);
    // Engine checks come first: their errors are clearer than the UI symptoms they cause.
    const counts = playerCounts(engine);
    const results = [];
    for (let i = 0; i < playouts; i++) {
      try { results.push(playout(engine, counts[i % counts.length], maxMoves)); }
      catch (error) { return fail("playout", [error.message]); }
    }
    if (scriptErrors.length) return fail("playout", scriptErrors);

    const shell = window.GameShell;
    if (!shell) return fail("load", ["The shell did not start; GameView.mount may have failed."]);
    if (!window.document.querySelector("#board *")) return fail("ui", ["GameView.mount/update rendered nothing into the container."]);

    // Play games through the shell (every player count, all seats human, hot-seat curtain
    // dismissed) so update() renders many positions, and click around the board as a human would.
    const aiStates = [];
    try {
      const games = Math.max(1, Math.ceil(3 / counts.length));
      for (const n of counts) {
        shell.configure({ players: n, seats: Array(n).fill("human") });
        for (let game = 0; game < games; game++) {
          shell.restart();
          shell.reveal();
          clickEverything();
          shell.restart();
          for (let moveNo = 0; moveNo < Math.min(maxMoves, 300); moveNo++) {
            shell.reveal();
            const state = shell.getState();
            if (engine.result(state)) break;
            if (moveNo % 15 === 0 && aiStates.length < 6) aiStates.push([n, state]);
            const moves = engine.legalMoves(state);
            if (!moves.length) throw new Error("legalMoves(state) returned no moves but result(state) is null.");
            const move = random(moves);
            if (!shell.play(move)) throw new Error(`The shell rejected legal move ${json(move)}; moves must be JSON-serializable and stable.`);
            if (moveNo === 5) { shell.reveal(); clickEverything(); shell.undo(); }
          }
          clickEverything();
          await sleep(50);
          if (scriptErrors.length) return fail("ui", scriptErrors);
        }
      }
      shell.restart();
    } catch (error) {
      return fail("ui", [describe(error)]);
    }
    await sleep(200);
    if (scriptErrors.length) return fail("ui", scriptErrors);

    // The computer opponent uses determinize/evaluate, so run a short search from a few positions.
    try {
      for (const [n, state] of aiStates) {
        shell.configure({ players: n, seats: Array(n).fill("human") });
        const move = shell.mctsMove(state, 40);
        if (!engine.legalMoves(state).some((m) => json(m) === json(move))) {
          throw new Error(`The computer opponent chose an illegal move ${json(move)}.`);
        }
      }
    } catch (error) {
      return fail("ai", [describe(error)]);
    }

    return {
      ok: true, stage: "complete", errors: [], name: engine.name, players: engine.players,
      stats: playouts ? playoutStats(results, playouts, counts) : null,
      diagnostics: notes.join("\n").slice(0, 5_000),
    };
  } finally {
    window.close();
  }
}

async function main(argv) {
  if (argv[0] === "--child") {
    const [, file, playouts, maxMoves] = argv;
    let result;
    try { result = await checkGame(file, { playouts: Number(playouts), maxMoves: Number(maxMoves) }); }
    catch (error) { result = failure("process", describe(error)); }
    process.stdout.write(JSON.stringify(result));
    process.exit(0);
  }
  const [file, playouts = "20", maxMoves = "1000"] = argv;
  if (!file) {
    console.error("Usage: node gameRunner.js <game.js> [playouts=20] [maxMoves=1000]");
    process.exitCode = 2;
    return;
  }
  const result = await validateGame(file, { playouts: Number(playouts), maxMoves: Number(maxMoves) });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === runnerFile) {
  main(process.argv.slice(2));
}
