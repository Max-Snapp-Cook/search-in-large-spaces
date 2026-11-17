import test from "node:test";
import assert from "node:assert/strict";
import { checkAgentPosition, checkAgentContext, checkAgentObservation, requireAgentMethods } from "./agentInterface.js";

function engineFixture(overrides = {}) {
  return {
    agentContext: () => ({ summary: "Named positions on a public board", map: { start: [1, 1], goal: [3, 3] } }),
    observe: (state, player) => ({ ...state, hands: state.hands.map((hand, i) => i === player - 1 ? hand : null), deck: null, seed: 0 }),
    currentPlayer: () => 1,
    result: state => state.over ? { winner: 1 } : null,
    legalMoves: () => [{ type: "end" }],
    agentObservation(observed, player) {
      assert.equal(observed.seed, undefined);
      assert.equal(observed.deck, null);
      assert.equal(observed.hands[2 - player], null);
      return { self: { player, name: `Player ${player}`, cards: observed.hands[player - 1] }, metrics: { "Orders filled": 0 } };
    },
    describeAction(observed) {
      assert.equal(observed.hands[1], null);
      return { label: "End turn without filling an order", category: "End turn" };
    },
    ...overrides,
  };
}
const state = { hands: [["my-card"], ["their-card"]], deck: ["future-card"], seed: 123, over: false };

test("interface checks operate only on masked observations in live and terminal states", () => {
  const engine = engineFixture();
  requireAgentMethods(engine);
  checkAgentContext(engine.agentContext());
  checkAgentPosition(engine, state, 2);
  checkAgentPosition(engine, { ...state, over: true }, 2);
  assert.equal(state.seed, 123);
});

test("interface rejects wrong identity, missing labels, mutation, and nondeterminism locally", () => {
  assert.throws(() => requireAgentMethods({}), /Generate a new game/);
  assert.throws(() => checkAgentContext({}), /summary/);
  assert.throws(() => checkAgentPosition(engineFixture({ agentObservation: () => ({ self: { player: 0, name: "Wrong" }, metrics: {} }) }), state, 2), /self.player=1/);
  assert.throws(() => checkAgentPosition(engineFixture({ describeAction: () => ({ label: "", category: "End" }) }), state, 2), /label/);
  assert.throws(() => checkAgentPosition(engineFixture({ describeAction(s) { s.hands = []; return {}; } }), state, 2), /mutated/);
  let count = 0;
  assert.throws(() => checkAgentPosition(engineFixture({ describeAction() { return { label: `${++count}`, category: "End" }; } }), state, 2), /deterministic/);
});

test("new generation requires endgame facts while old games and uncertain endings remain supported", () => {
  assert.throws(() => checkAgentPosition(engineFixture(), state, 2, { requireEndgame: true }), /agentObservation.endgame/);
  const observation = { self: { player: 1, name: "One" }, metrics: {}, endgame: {
    endingConditions: "A player completes an objective.", remaining: "Unknown; depends on future moves.",
    scoring: "Completed objectives count.", tiebreakers: "Shared victory.", uncertainty: "The ending turn is unknown." } };
  assert.equal(checkAgentObservation(observation, 1).endgame.remaining, observation.endgame.remaining);
  assert.throws(() => checkAgentObservation({ ...observation, endgame: { ...observation.endgame, remaining: 3 } }, 1), /agentObservation.endgame/);
});
