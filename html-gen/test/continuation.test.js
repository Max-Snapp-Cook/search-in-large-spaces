import test from "node:test";
import assert from "node:assert/strict";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { continuationMessages, joinContinuation } from "../src/continuation.js";

const partial = "```javascript\n(function () {\n  const K = window.GameKit;\n  function setup(players) {\n    return { players";

test("joinContinuation appends a clean continuation", () => {
  assert.equal(joinContinuation(partial, ", turn: 0 };\n  }\n})();\n```"), partial + ", turn: 0 };\n  }\n})();\n```");
});

test("joinContinuation drops a reopened code fence inside an open block", () => {
  assert.equal(joinContinuation(partial, "```javascript\n, turn: 0 };\n```"), partial + ", turn: 0 };\n```");
  // With the block already closed, a new fence is kept.
  assert.equal(joinContinuation("```js\nx\n```\n", "```js\nmore"), "```js\nx\n```\n```js\nmore");
});

test("joinContinuation removes text the model repeated", () => {
  const repeated = "  function setup(players) {\n    return { players, turn: 0 };";
  assert.equal(joinContinuation(partial, repeated), partial + ", turn: 0 };");
  // A short coincidental overlap is not treated as a repeat.
  assert.equal(joinContinuation("a = 1;\n}\n", "}\nb"), "a = 1;\n}\n}\nb");
});

test("continuationMessages resends the request with the partial reply and a continue instruction", () => {
  const messages = [new SystemMessage("sys"), new HumanMessage("write game.js")];
  const out = continuationMessages(messages, partial);
  assert.equal(out.length, 4);
  assert.deepEqual(out.slice(0, 2), messages);
  assert.equal(out[2]._getType(), "ai");
  assert.equal(out[2].content, partial);
  assert.match(out[3].content, /exact character/);
});
