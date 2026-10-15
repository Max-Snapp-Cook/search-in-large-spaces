import test from "node:test";
import assert from "node:assert/strict";
import { parseBridgeResult, repairFeedback, validateWithLudii, buildBridge } from "./ludiiRunner.js";

test("preserves compiler errors and stderr even with a nonzero exit", () => {
  const result = parseBridgeResult({
    error: { code: 1 },
    stdout: JSON.stringify({ ok: false, stage: "compile", errors: ["Invalid ludeme"], stats: null }),
    stderr: "Compiler detail\n",
  });
  assert.equal(result.stage, "compile");
  assert.match(repairFeedback(result), /Invalid ludeme\nCompiler detail/);
});

test("successful result keeps stats and does not request repair", () => {
  const result = parseBridgeResult({ error: null, stderr: "", stdout: JSON.stringify({
    ok: true, stage: "complete", errors: [], stats: { completed: 2, moveLimitReached: 1 },
  }) });
  assert.equal(result.stats.moveLimitReached, 1);
  assert.equal(repairFeedback(result), null);
});

test("process failures never become game-repair feedback", () => {
  for (const [error, stdout, expected] of [
    [{ killed: true }, "", "timeout"],
    [{ code: "ENOENT" }, "", "setup"],
    [{ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", message: "Too much output" }, "", "process"],
    [{ code: 1 }, "", "process"],
    [null, "not JSON", "process"],
    [null, "null", "process"],
    [null, "{}", "process"],
    [{ code: 1 }, '{"ok":true,"stage":"complete","errors":[]}', "process"],
  ]) {
    const result = parseBridgeResult({ error, stdout, stderr: "diagnostics" });
    assert.equal(result.ok, false);
    assert.equal(result.stage, expected);
    assert.equal(repairFeedback(result), null);
  }
});

test("rejects invalid options and missing files before starting Java", async () => {
  assert.equal((await validateWithLudii("examples/tic-tac-toe.lud", { playouts: -1 })).stage, "input");
  assert.equal((await validateWithLudii("examples/tic-tac-toe.lud", { maxMoves: 0 })).stage, "input");
  assert.equal((await validateWithLudii("examples/tic-tac-toe.lud", { timeoutMs: 0 })).stage, "input");
  assert.equal((await validateWithLudii("missing-game-for-test.lud")).stage, "input");
  assert.equal((await validateWithLudii("examples/tic-tac-toe.lud", { jarPath: "missing-jar-for-test.jar" })).stage, "setup");
  assert.equal((await buildBridge({ jarPath: "missing-jar-for-test.jar" })).stage, "setup");
});
