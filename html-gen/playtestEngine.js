// Headless access to the existing browser engine. No shell AI or UI is started.
import fs from "node:fs/promises";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { agentMethods } from "./agentInterface.js";

export async function loadPlaytestEngine(gameFile, { timeoutMs = 2000 } = {}) {
  const [shell, code] = await Promise.all([
    fs.readFile(new URL("./shell/index.html", import.meta.url), "utf8"),
    fs.readFile(gameFile, "utf8"),
  ]);
  const kit = [...shell.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1]).find((script) => script.includes("window.GameKit ="));
  if (!kit) throw new Error("Could not find GameKit in the shell.");
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only" });
  const context = dom.getInternalVMContext();
  // Generated games are local code, as in the validator; this is not a security sandbox.
  // Disable asynchronous work: the engine contract consists entirely of synchronous calls.
  for (const name of ["setTimeout", "setInterval", "requestAnimationFrame", "fetch", "XMLHttpRequest", "WebSocket"]) {
    dom.window[name] = () => { throw new Error(`${name} is unavailable in the playtest engine`); };
  }
  const execute = (source, filename) => new vm.Script(source, { filename }).runInContext(context, { timeout: timeoutMs });
  try {
    execute(kit, "GameKit.js");
    execute(code, gameFile);
    const info = JSON.parse(execute(`JSON.stringify((() => {
      const e = window.GameEngine;
      if (!e) throw new Error("GameEngine is missing");
      for (const key of ["initialState", "currentPlayer", "legalMoves", "applyMove", "result"]) {
        if (typeof e[key] !== "function") throw new Error("GameEngine." + key + " is missing");
      }
      if (e.hidden && typeof e.observe !== "function") throw new Error("Hidden games require observe");
      const missing = ${JSON.stringify(agentMethods)}.filter(name => typeof e[name] !== "function");
      if (missing.length) throw new Error("Missing agent interface: " + missing.join(", ") + ". Generate a new game with the current contract before LLM playtesting.");
      return { name: e.name, rules: e.rules, players: e.players,
        minPlayers: e.minPlayers ?? e.players, maxPlayers: e.maxPlayers ?? e.players,
        playerNames: e.playerNames, hidden: !!e.hidden, hasObserve: typeof e.observe === "function",
        hasDescription: typeof e.describeMove === "function" };
    })())`, "engine-api.js"));
    const call = (method, ...args) => {
      // JSON serialization happens inside the timeout too, and detaches every returned value.
      const source = `(() => {
        const args = ${JSON.stringify(args)}, before = JSON.stringify(args);
        const result = window.GameEngine[${JSON.stringify(method)}](...args);
        if (JSON.stringify(args) !== before) throw new Error(${JSON.stringify(`${method} mutated its input`)});
        if (${JSON.stringify(method)} === "applyMove" && result === args[0]) throw new Error("applyMove must return a NEW state");
        return JSON.stringify(result);
      })()`;
      const result = execute(source, `engine-${method}.js`);
      if (result === undefined) throw new Error(`GameEngine.${method} returned undefined`);
      return JSON.parse(result);
    };
    return { info, call, close: () => dom.window.close() };
  } catch (error) {
    dom.window.close();
    throw error;
  }
}
