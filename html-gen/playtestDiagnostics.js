// Derive diagnostics from the audit trail, including older logs that lack request IDs/raw replies.
export function summarizeDiagnostics(events) {
  let currentDecision = null;
  const responses = new Map(), retries = new Set(), recovered = new Set(), errors = [];
  const group = (event, decision) => `${event.kind}:${event.player}:${decision ?? "reflection"}`;
  for (const event of events) {
    if (event.type === "agent_deciding") currentDecision = event.decision;
    const decision = event.kind === "move" ? event.decision ?? currentDecision : null;
    const key = group(event, decision);
    const request = event.requestId ?? `${key}:${event.attempt}`;
    if (["agent_response", "agent_error"].includes(event.type) && event.attempt > 1) retries.add(request);
    if (event.type === "agent_response") responses.set(request, event);
    if (event.type === "agent_error") {
      const response = responses.get(request);
      errors.push({ sequence: event.sequence, at: event.at, player: event.player, kind: event.kind,
        decision, attempt: event.attempt, requestId: event.requestId ?? null, error: event.error,
        code: event.code ?? null, stage: event.stage ?? "not recorded",
        finishReason: event.finishReason ?? response?.finishReason ?? null,
        rawResponseRecorded: Object.hasOwn(event, "rawResponse") && event.rawResponse !== null,
        usage: event.usage ?? response?.usage ?? null, group: key });
    }
    if (event.type === "move_accepted") recovered.add(`move:${event.player}:${event.decision}`);
    if (event.type === "reflection_received" && event.feedback) recovered.add(`reflection:${event.player}:reflection`);
  }
  const failedUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, attemptsWithoutUsage: 0 };
  for (const error of errors) {
    error.recovered = recovered.has(error.group);
    delete error.group;
    if (Number.isFinite(error.usage?.total_tokens)) {
      failedUsage.inputTokens += error.usage.input_tokens || 0;
      failedUsage.outputTokens += error.usage.output_tokens || 0;
      failedUsage.totalTokens += error.usage.total_tokens;
    } else failedUsage.attemptsWithoutUsage++;
  }
  return { failedAttempts: errors.length, recoveredAttempts: errors.filter(e => e.recovered).length,
    unrecoveredAttempts: errors.filter(e => !e.recovered).length, retryRequests: retries.size,
    affectedDecisions: [...new Set(errors.filter(e => e.kind === "move").map(e => e.decision))],
    failedUsage, errors };
}

const cell = value => String(value ?? "not recorded").replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");

export function renderDiagnostics(metadata) {
  const d = metadata.diagnostics;
  if (!d) return ["## Run diagnostics", "", "Diagnostics were not supplied; this does not establish an error-free run.", ""];
  const lines = ["## Run diagnostics", "",
    "Game completion and request reliability are separate: a completed game may include recovered errors.", "",
    `Failed attempts: **${d.failedAttempts}**. Recovered: **${d.recoveredAttempts}**. Not recovered: **${d.unrecoveredAttempts}**.`,
    `Retry requests: **${d.retryRequests}**. Move decisions affected: **${d.affectedDecisions.length}**.`, "",
    `Total model requests: ${metadata.usage?.requests ?? "not recorded"}. Reported total tokens: ${metadata.usage?.totalTokens ?? "not recorded"}.`,
    `Failed-attempt tokens: **${d.failedUsage.totalTokens}** (${d.failedUsage.inputTokens} input + ${d.failedUsage.outputTokens} output). Attempts without usage: ${d.failedUsage.attemptsWithoutUsage}.`, "",
    "Failed-attempt tokens are a subset of total usage, not an additional charge. Missing usage is unknown, not zero; these are provider-reported token counts, not a billing estimate.", ""];
  if (d.errors.length) {
    lines.push("Rejected response bodies and provider finish reasons, when captured, are stored on agent_error events in [transcript.jsonl](transcript.jsonl). They are organizer diagnostics and are not sent to opponents.", "");
    if (d.errors.some(e => !e.rawResponseRecorded)) lines.push("Some raw responses were not recorded or no response arrived. Older discarded responses cannot be recovered retroactively. Their exact field values and finish reasons remain unknown.", "");
    lines.push("| Decision / phase | Player | Attempt | Error | Outcome | Finish reason | Tokens | Transcript event |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const e of d.errors) lines.push(`| ${e.kind === "move" ? e.decision ?? "unknown decision" : "reflection"} | ${e.player} | ${e.attempt} | ${cell(e.error)} | ${e.recovered ? "Recovered" : "Not recovered"} | ${cell(e.finishReason)} | ${e.usage?.total_tokens ?? "unknown"} | ${e.sequence} |`);
    lines.push("");
  }
  return lines;
}
