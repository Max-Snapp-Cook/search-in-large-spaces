import test from "node:test";
import assert from "node:assert/strict";
import { sourceContext } from "./errorContext.js";
import { repairFeedback } from "./ludiiRunner.js";

test("unexpected syntax gets numbered context and ambiguous matches", () => {
  const source = '(game "Test"\r\n (enclose\r\n  Hexagon\r\n )\r\n)\r\n// Hexagon';
  const [context] = sourceContext(source, ["Unexpected syntax 'Hexagon' in '(enclose ...'."]);
  assert.equal(context.totalMatches, 2);
  assert.equal(context.candidates[0].line, 3);
  assert.match(context.candidates[0].excerpt, /3:   Hexagon/);
  assert.match(context.locationType, /candidate/);
});

test("unknown macros, missing matches, and generic exceptions are handled", () => {
  const [context] = sourceContext('(then "Missing")', ["Couldn't find ludeme class for token '\"Missing\"'."]);
  assert.equal(context.candidates[0].line, 1);
  assert.deepEqual(sourceContext("code", ["Unexpected syntax 'Unknown' in '(game ...'."])[0].candidates, []);
  assert.deepEqual(sourceContext("code", ["java.lang.NullPointerException"]), []);
});

test("source context is bounded and prioritized before noisy diagnostics", () => {
  const context = sourceContext('Bad\n'.repeat(10), ["Couldn't find token 'Bad'."]);
  assert.equal(context[0].candidates.length, 5);
  assert.equal(context[0].truncated, true);
  const feedback = repairFeedback({ ok: false, stage: "compile", errors: ["wrapper"],
    compilerReport: { errors: ["specific error"], warnings: ["warning"], notes: ["note"] },
    sourceContext: context, diagnostics: "x".repeat(25000) });
  assert.match(feedback, /specific error/);
  assert.match(feedback, /Candidate source locations/);
  assert.match(feedback, /Warning: warning/);
  assert.equal(feedback.length, 20000);
});
