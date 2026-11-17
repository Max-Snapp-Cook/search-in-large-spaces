import test from "node:test";
import assert from "node:assert/strict";
import { summarize } from "./modelBenchmark.js";

test("benchmark totals include failed requests and distinguish missing usage from zero", () => {
  const config = { variants: [{ id: "candidate", model: "model" }] };
  const rows = [
    { variant: "candidate", caseId: "a", attempt: 1, accepted: false, elapsedMs: 200, usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } },
    { variant: "candidate", caseId: "a", attempt: 2, accepted: true, elapsedMs: 300, usage: { prompt_tokens: 120, completion_tokens: 20, total_tokens: 140, completion_tokens_details: { reasoning_tokens: 0 } } },
    { variant: "candidate", caseId: "b", attempt: 1, accepted: false, elapsedMs: 900, usage: null },
  ];
  const [result] = summarize(config, [{}, {}], rows);
  assert.equal(result.accepted, 1);
  assert.equal(result.firstAttemptAccepted, 0);
  assert.equal(result.meanAcceptedDecisionMs, 500);
  assert.equal(result.meanTestedCaseMs, 700); // includes the fully failed case's time
  assert.equal(result.totalRequestMs, 1400);
  assert.equal(result.medianRequestMs, 300);
  assert.deepEqual(result.totalTokens, { reported: 250, requestsWithoutValue: 1 });
  assert.deepEqual(result.reasoningTokens, { reported: 0, requestsWithoutValue: 2 });
});
