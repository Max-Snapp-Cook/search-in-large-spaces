import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseAgentReply } from "./playerAgent.js";
import { summarizeDiagnostics, renderDiagnostics } from "./playtestDiagnostics.js";
import { rebuildReport } from "./playtestReport.js";

test("response diagnostics distinguish malformed JSON, missing/wrong/blank/long fields, and illegal IDs", () => {
  const base = { feeling: "Fine", reason: "Advance" };
  const cases = [
    ["{broken", "invalid_json", /not valid JSON/],
    [[], "expected_object", /JSON object/],
    [base, "missing_field", /moveId is missing/],
    [{ ...base, moveId: 1 }, "wrong_field_type", /string.*number/],
    [{ ...base, moveId: null }, "wrong_field_type", /string.*null/],
    [{ ...base, moveId: {} }, "wrong_field_type", /string.*object/],
    [{ ...base, moveId: " \n" }, "blank_field", /must not be blank/],
    [{ ...base, moveId: "x".repeat(1201) }, "field_too_long", /1200.*1201/],
    [{ ...base, moveId: "unknown" }, "illegal_move_id", /supplied legalMoves/],
  ];
  for (const [raw, code, message] of cases) assert.throws(() => parseAgentReply(raw, "move", [{ id: "d1-m1" }]), e => e.code === code && message.test(e.message));
});

const legacyEvents = [
  { type: "agent_deciding", decision: 2, player: 1 },
  { type: "agent_response", player: 1, kind: "move", attempt: 1, usage: { input_tokens: 100, output_tokens: 60, total_tokens: 160 } },
  { type: "agent_error", player: 1, kind: "move", attempt: 1, error: "Missing, empty, or excessively long moveId" },
  { type: "agent_response", player: 1, kind: "move", attempt: 2, usage: { total_tokens: 170 } },
  { type: "move_accepted", player: 1, decision: 2, move: { type: "end" }, action: { label: "End turn" }, feeling: "Fine", reason: "Done" },
  { type: "agent_error", player: 2, kind: "reflection", attempt: 1, error: "Timed out" },
  { type: "reflection_received", player: 2, error: "Timed out" },
  { type: "run_finished" },
].map((e, i) => ({ ...e, sequence: i + 1 }));

test("older logs recover error context and usage without inventing discarded responses", () => {
  const d = summarizeDiagnostics(legacyEvents);
  assert.equal(d.failedAttempts, 2);
  assert.equal(d.recoveredAttempts, 1);
  assert.equal(d.unrecoveredAttempts, 1);
  assert.equal(d.retryRequests, 1);
  assert.deepEqual(d.affectedDecisions, [2]);
  assert.equal(d.failedUsage.totalTokens, 160);
  assert.equal(d.failedUsage.attemptsWithoutUsage, 1);
  assert.equal(d.errors[0].rawResponseRecorded, false);
  assert.equal(d.errors[0].finishReason, null);
  assert.equal(d.errors[1].decision, null);
  const report = renderDiagnostics({ diagnostics: d, usage: { requests: 4, totalTokens: 330 } }).join("\n");
  assert.match(report, /Missing, empty, or excessively long moveId/);
  assert.match(report, /cannot be recovered retroactively/);
  assert.match(report, /not an additional charge/);
});

test("offline report rebuilding preserves the original and changes no transcript or metadata", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "playtest-report-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const metadata = JSON.stringify({ game: "Test", status: "complete", feedbackStatus: "partial", seats: [] });
  const transcript = legacyEvents.map(e => JSON.stringify(e)).join("\n");
  await fs.writeFile(path.join(dir, "metadata.json"), metadata);
  await fs.writeFile(path.join(dir, "transcript.jsonl"), transcript);
  await fs.writeFile(path.join(dir, "report.md"), "Original report");
  await rebuildReport(dir);
  await rebuildReport(dir);
  assert.equal(await fs.readFile(path.join(dir, "report.original.md"), "utf8"), "Original report");
  assert.equal(await fs.readFile(path.join(dir, "metadata.json"), "utf8"), metadata);
  assert.equal(await fs.readFile(path.join(dir, "transcript.jsonl"), "utf8"), transcript);
  assert.match(await fs.readFile(path.join(dir, "report.md"), "utf8"), /Missing, empty, or excessively long moveId/);
  await fs.writeFile(path.join(dir, "transcript.jsonl"), "");
  await assert.rejects(rebuildReport(dir), /Only rebuild finished/);
});
