// Shared, local checks for the generated game's LLM-facing interface. No model calls.
export const agentMethods = ["agentContext", "agentObservation", "describeAction"];
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;

export function requireAgentMethods(engine) {
  const missing = agentMethods.filter((name) => typeof engine[name] !== "function");
  if (missing.length) throw new Error(`Missing agent interface: ${missing.join(", ")}. Generate a new game with the current contract before LLM playtesting.`);
}

// RNG fields are implementation details, even in perfect-information games.
export function withoutSeeds(value) {
  if (Array.isArray(value)) return value.map(withoutSeeds);
  if (object(value)) return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/^(seed|rng_?seed|random_?seed)$/i.test(key)).map(([key, item]) => [key, withoutSeeds(item)]));
  return value;
}

export function checkAgentContext(value) {
  if (!object(value) || !text(value.summary)) throw new Error("agentContext must return an object with a readable summary and the game's static public information");
  return withoutSeeds(value);
}

export function checkAgentObservation(value, player) {
  if (!object(value) || !object(value.self) || value.self.player !== player || !text(value.self.name) || !object(value.metrics)) {
    throw new Error(`agentObservation must return self.player=${player}, self.name, and a metrics object`);
  }
  // Older games remain playable. When supplied, the new summary must be readable and bounded.
  if (value.endgame !== undefined) {
    if (!object(value.endgame) || ["endingConditions", "remaining", "scoring", "tiebreakers", "uncertainty"].some(key => !text(value.endgame[key]) || value.endgame[key].length > 800)) {
      throw new Error("agentObservation.endgame must supply endingConditions, remaining, scoring, tiebreakers, and uncertainty as nonblank strings up to 800 characters each");
    }
  }
  return withoutSeeds(value);
}

export function checkAgentAction(value) {
  if (!object(value) || !text(value.label) || !text(value.category) || value.label.length > 500 || value.category.length > 80) {
    throw new Error("describeAction must return a readable label (1–500 characters) and a stable category (1–80 characters)");
  }
  return { label: value.label, category: value.category };
}

// Check generated descriptions during random validation, including terminal states.
export function checkAgentPosition(engine, state, players, { requireEndgame = false } = {}) {
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const checkedCall = (method, args) => {
    const before = JSON.stringify(args);
    const first = engine[method](...args);
    if (JSON.stringify(args) !== before) throw new Error(`${method} mutated its input`);
    const serialized = JSON.stringify(first);
    const second = engine[method](...args);
    if (JSON.stringify(args) !== before) throw new Error(`${method} mutated its input`);
    if (serialized !== JSON.stringify(second)) throw new Error(`${method} must be deterministic`);
    return copy(first);
  };
  const original = JSON.stringify(state);
  for (let player = 1; player <= players; player++) {
    const observed = withoutSeeds(engine.observe ? engine.observe(copy(state), player) : copy(state));
    const observation = checkAgentObservation(checkedCall("agentObservation", [observed, player]), player);
    if (requireEndgame && !observation.endgame) throw new Error("New games must provide agentObservation.endgame with ending conditions, remaining time, scoring, tiebreakers, and uncertainty");
    if (engine.result(state) == null && engine.currentPlayer(state) === player) {
      const moves = engine.legalMoves(state);
      // Include the first, middle, and last choices (often pass/end-turn), without checking thousands of labels.
      for (const index of new Set([0, Math.floor(moves.length / 2), moves.length - 1])) {
        if (index >= 0 && index < moves.length) checkAgentAction(checkedCall("describeAction", [observed, copy(moves[index]), player]));
      }
    }
  }
  if (JSON.stringify(state) !== original) throw new Error("Agent interface checks mutated the game state");
}
