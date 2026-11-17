import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarize } from "./modelBenchmark.js";

export async function writeBenchmarkReport(dir) {
  const config = JSON.parse(await fs.readFile(path.join(dir, "config.json"), "utf8"));
  const cases = JSON.parse(await fs.readFile(path.join(dir, "cases.json"), "utf8"));
  const attempts = (await fs.readFile(path.join(dir, "attempts.jsonl"), "utf8")).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  let review = null;
  try { review = JSON.parse(await fs.readFile(path.join(dir, "review.json"), "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
  const summary = summarize(config, cases, attempts);
  const sec = n => n == null ? "unknown" : (n / 1000).toFixed(2);
  const tokens = n => `${n.reported.toLocaleString("en-US")}${n.requestsWithoutValue ? ` (+ ${n.requestsWithoutValue} unknown)` : ""}`;
  const lines = ["# Cindertrail frozen-position model comparison", "",
    `Ten archived positions, ${config.variants.length} model configurations. One sampled decision per configuration/position, with at most ${config.maxAttempts - 1} retry.`, "",
    "Each candidate receives the same current production move prompt and reconstructed factual history. No past subjective commentary or expected answer is supplied. Exact prompts and every legal action's resulting observation are in cases.json. No extra LLM judge requests were used.", "",
    "Requests run sequentially, with model order rotated per position. Latency is client wall time from sending a request through receiving its full response, including provider queueing/network time; it is not time to first token. Accepted-decision latency includes failed attempts for that case. This is a small diagnostic sample, not a model leaderboard or a win-rate evaluation.", "",
    `Output budget: ${config.maxTokens} tokens initially; ${config.retryMaxTokens} after truncation. Timeout: ${config.timeoutMs / 1000}s per attempt. Reasoning controls are requested through BayLeaf's OpenRouter-compatible API; reported reasoning-token usage is saved to check their observed behavior. Other sampling parameters use provider defaults.`, "",
    "| Configuration | Accepted | First attempt | Requests | Mean request (s) | Median request (s) | Mean accepted decision (s) | Mean tested position incl. failures (s) | Input tokens | Output tokens | Reasoning tokens* | Total tokens |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...summary.map(s => `| ${s.variant} | ${s.accepted}/${s.cases} | ${s.firstAttemptAccepted}/${s.cases} | ${s.requests} | ${sec(s.meanRequestMs)} | ${sec(s.medianRequestMs)} | ${sec(s.meanAcceptedDecisionMs)} | ${sec(s.meanTestedCaseMs)} | ${tokens(s.inputTokens)} | ${tokens(s.outputTokens)} | ${tokens(s.reasoningTokens)} | ${tokens(s.totalTokens)} |`), "",
    "*Reasoning tokens are a subset of output tokens, not additional tokens. All totals include failed and truncated responses. Missing usage is marked unknown. Tokens are provider-reported and may include cached input; models use different tokenizers. Accepted means valid response format and a legal move ID, not correct reasoning or strong play.", "",
    "## Configurations", "", ...config.variants.map(v => `- **${v.id}**: \`${v.model}\`; reasoning request: \`${JSON.stringify(v.reasoning ?? "provider default")}\`.`), "",
    "## Positions", "", ...cases.map(c => `- **${c.id}**: player ${c.player}, archived decision ${c.decision}; ${c.input.legalMoves.length} legal choices. Source: ${c.source}`), "",
    "## Interpretation", "", ...(review ? [review.method, "", review.conclusion, "",
      "| Configuration | Accepted explanations reviewed | With a clear factual contradiction |",
      "| --- | ---: | ---: |", ...review.acceptedExplanationAudit.map(a => `| ${a.variant} | ${a.accepted} | ${a.clearContradictions} |`), "",
      ...review.findings.map(f => `- **${f.variant}, ${f.caseId}**: ${f.finding}`)] : ["Qualitative review pending. Consult responses.md and the engine-derived outcomes before interpreting legal responses as correct reasoning."]), "",
    "## Files", "", "- `attempts.jsonl`: every request's timing, usage, completion status, visible response, selected action, and resulting observation.",
    "- `timings.csv`: request-level timing and token counts.", "- `summary.json`: aggregate metrics, including unknown-usage counts.",
    "- `cases.json`: exact frozen prompts and engine-derived counterfactual outcomes.", "- `config.json` and `models.json`: requested settings and provider model metadata.",
    "- `responses.md`: all visible responses for inspection.", ""];
  const games = [];
  let folders = [];
  try { folders = await fs.readdir(path.join(dir, "full-games")); } catch (e) { if (e.code !== "ENOENT") throw e; }
  for (const folder of folders) {
    const matchDir = path.join(dir, "full-games", folder);
    let run;
    try { run = JSON.parse(await fs.readFile(path.join(matchDir, "benchmark-run.json"), "utf8")); } catch (e) { if (e.code === "ENOENT") continue; throw e; }
    const requests = (await fs.readFile(path.join(matchDir, "requests.jsonl"), "utf8")).trim().split(/\r?\n/).map(JSON.parse);
    const replay = JSON.parse(await fs.readFile(path.join(matchDir, "replay.json"), "utf8"));
    const totals = key => requests.reduce((n, r) => n + (Number.isFinite(r.usage?.[key]) ? r.usage[key] : 0), 0);
    games.push({ folder, ...run, decisions: replay.moves.length, requests: requests.length,
      emptyCoolPasses: replay.moves.filter(e => e.move.type === "cool" && e.move.at === undefined).length,
      inputTokens: totals("prompt_tokens"), outputTokens: totals("completion_tokens"), totalTokens: totals("total_tokens"),
      requestsWithoutUsage: requests.filter(r => !Number.isFinite(r.usage?.total_tokens)).length,
      totalRequestMs: requests.reduce((n, r) => n + r.elapsedMs, 0),
      meanMoveRequestMs: requests.filter(r => r.kind === "move").reduce((n, r) => n + r.elapsedMs, 0) / requests.filter(r => r.kind === "move").length });
    const csv = ["kind,player,decision,elapsed_ms,input_tokens,output_tokens,reasoning_tokens,total_tokens,finish_reason",
      ...requests.map(r => [r.kind, r.player, r.decision, r.elapsedMs, r.usage?.prompt_tokens, r.usage?.completion_tokens,
        r.usage?.completion_tokens_details?.reasoning_tokens, r.usage?.total_tokens, r.finishReason].map(v => JSON.stringify(String(v ?? ""))).join(","))].join("\n");
    await fs.writeFile(path.join(matchDir, "timings.csv"), csv);
  }
  await fs.writeFile(path.join(dir, "full-game-summary.json"), JSON.stringify(games, null, 2));
  const experiment = {
    frozenPositionRequests: attempts.length,
    fullGameRequests: games.reduce((n, g) => n + g.requests, 0),
    reportedTotalTokens: summary.reduce((n, s) => n + s.totalTokens.reported, 0) + games.reduce((n, g) => n + g.totalTokens, 0),
    requestsWithoutTotalUsage: summary.reduce((n, s) => n + s.totalTokens.requestsWithoutValue, 0) + games.reduce((n, g) => n + g.requestsWithoutUsage, 0),
    totalRequestMs: summary.reduce((n, s) => n + s.totalRequestMs, 0) + games.reduce((n, g) => n + g.totalRequestMs, 0),
  };
  await fs.writeFile(path.join(dir, "experiment-summary.json"), JSON.stringify(experiment, null, 2));
  await fs.writeFile(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2));
  if (games.length) lines.push("## Full-game follow-ups", "",
    "Each game uses the same archived initial state, with both seats controlled by the named candidate. Requests use an 8192-token cap from the start, one retry, and a 90-second timeout. These are single self-play games, not head-to-head matches between models. Their histories diverge after the first move, so timings are not controlled comparisons of identical prompts. Usage includes final reflections and failed requests; mean move time excludes reflection requests.", "",
    "| Configuration | Game / feedback | Decisions | Banked scores | Empty passes | Mean move request (s) | Run elapsed (s) | Reported total tokens | Missing usage |",
    "| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |",
    ...games.map(g => `| ${g.variant.id} | ${g.status} / ${g.feedbackStatus} | ${g.decisions} | ${JSON.stringify(g.result?.scores)} | ${g.emptyCoolPasses} | ${sec(g.meanMoveRequestMs)} | ${sec(g.elapsedMs)} | ${g.totalTokens.toLocaleString("en-US")} | ${g.requestsWithoutUsage} |`), "",
    ...games.map(g => `- **${g.variant.id}**: [Replay](full-games/${g.folder}/replay.html), [report](full-games/${g.folder}/report.md), [per-generation timing and tokens](full-games/${g.folder}/timings.csv).`), "");
  lines.push("## Combined recorded usage", "",
    `${experiment.frozenPositionRequests} frozen-position requests plus ${experiment.fullGameRequests} requests in finished follow-up runs: **${experiment.reportedTotalTokens.toLocaleString("en-US")} reported tokens**. ${experiment.requestsWithoutTotalUsage} requests have unknown total usage.`, "",
    `Sum of request durations: ${sec(experiment.totalRequestMs)} seconds. This excludes offline preparation, assessment and gaps between runs; it is not total wall time for the experiment.`, "");
  await fs.writeFile(path.join(dir, "report.md"), lines.join("\n"));
  const responses = ["# Visible responses and factual outcomes", "", "These are sampled choices, not a continuation of the original games. Private model reasoning text is not saved.", ""];
  for (const c of cases) {
    responses.push(`## ${c.id}`, "", `Player ${c.player}. Current facts:`, "", "```json", JSON.stringify(c.input.observation, null, 2), "```", "");
    for (const r of attempts.filter(r => r.caseId === c.id)) {
      responses.push(`### ${r.variant}, attempt ${r.attempt}`, "", `${r.elapsedMs} ms; ${r.usage?.total_tokens ?? "unknown"} total tokens; finish: ${r.finishReason ?? "unknown"}.`, "",
        r.accepted ? `**Selected:** ${r.selected.action.label}` : `**Failed:** ${r.error}`, "", r.reply?.feeling ?? "", "", r.reply?.reason ?? r.rawResponse ?? "No visible response.", "");
      if (r.selected) responses.push("Resulting player facts:", "", "```json", JSON.stringify({ self: r.selected.after.self, metrics: r.selected.after.metrics, decision: r.selected.after.decision, result: r.selected.after.result }, null, 2), "```", "");
    }
  }
  await fs.writeFile(path.join(dir, "responses.md"), responses.join("\n"));
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeBenchmarkReport(path.resolve(process.argv[2])).then(() => console.log("Benchmark report written.")).catch(e => { console.error(e.message); process.exitCode = 1; });
}
