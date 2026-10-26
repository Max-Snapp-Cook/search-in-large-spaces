import test from "node:test";
import assert from "node:assert/strict";
import { parseBridgeResult, repairFeedback, validateWithLudii, buildBridge } from "./ludiiRunner.js";

test("oversized diagnostics are bounded on both success and process failure", () => {
  const stderr = "start\n" + "x".repeat(4_000_000) + "\nlast error";
  for (const error of [null, { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", message: "output limit" }]) {
    const result = parseBridgeResult({ error, stderr,
      stdout: JSON.stringify({ ok: true, stage: "complete", errors: [] }) });
    assert.ok(result.diagnostics.length <= 8000);
    assert.equal(result.diagnosticsTruncated, true);
    assert.match(result.diagnostics, /last error$/);
  }
});

test("HTML source dumps and verbose logs are compacted in JSON", () => {
  const result = parseBridgeResult({ error: { code: 1 }, stderr: "",
    stdout: JSON.stringify({ ok: false, stage: "compile",
      errors: ['<html><h2>Bad syntax</h2><p>' + 'source'.repeat(10000) + '</p></html>'],
      compilerReport: { errors: [], warnings: [], notes: [], log: 'x'.repeat(32000) } }),
  });
  assert.deepEqual(result.errors, ["Bad syntax"]);
  assert.equal(result.compilerReport.logTruncated, true);
  assert.ok(result.compilerReport.log.length <= 8000);
  assert.ok(JSON.stringify(result).length < 10000);
});

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
