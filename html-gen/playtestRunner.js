import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseAgentReply, reflectionFields } from "./playerAgent.js";
import { withoutSeeds, checkAgentContext, checkAgentObservation, checkAgentAction } from "./agentInterface.js";
import { summarizeDiagnostics, renderDiagnostics } from "./playtestDiagnostics.js";
export { withoutSeeds } from "./agentInterface.js";

const copy = (value) => JSON.parse(JSON.stringify(value));

export function checkedResult(result, players) {
  if (result === null) return null;
  const validPlayer = (p) => Number.isSafeInteger(p) && p >= 1 && p <= players;
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid engine result");
  if (result.winners !== undefined) {
    if (!Array.isArray(result.winners) || !result.winners.length || !result.winners.every(validPlayer)) throw new Error("Invalid winners");
  } else if (result.winner !== null && !validPlayer(result.winner)) throw new Error("Invalid winner");
  if (result.scores !== undefined && (!Array.isArray(result.scores) || result.scores.length !== players || !result.scores.every(Number.isFinite))) {
    throw new Error("Invalid scores");
  }
  return result;
}

export function boundedHistory(history, maxChars) {
  const recent = [];
  let size = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const length = JSON.stringify(history[i]).length;
    if (size + length > maxChars) break;
    recent.unshift(history[i]);
    size += length;
  }
  return { omittedEarlierEvents: history.length - recent.length, events: recent };
}

// Compact, deterministic changes to readable fields. Never retain past board/state snapshots in prompts.
export function observationChanges(before, after, maxChars = 1200) {
  const changes = [];
  let size = 0, omittedChanges = 0;
  const visit = (oldValue, newValue, field) => {
    if (isDeepStrictEqual(oldValue, newValue)) return;
    const object = (v) => v !== null && typeof v === "object";
    if (object(oldValue) && object(newValue) && Array.isArray(oldValue) === Array.isArray(newValue)) {
      for (const key of new Set([...Object.keys(oldValue), ...Object.keys(newValue)])) {
        visit(oldValue[key], newValue[key], field ? `${field}.${key}` : key);
      }
    } else {
      const change = { field, before: oldValue ?? null, after: newValue ?? null };
      const length = JSON.stringify(change).length;
      if (size + length > maxChars) omittedChanges++;
      else { changes.push(change); size += length; }
    }
  };
  visit(before, after, "");
  return { changes, omittedChanges };
}

export function playerFacts(player, moves, result, observation, status) {
  const personal = moves.filter((move) => move.player === player);
  const counts = new Map();
  for (const move of personal) counts.set(move.action.category, (counts.get(move.action.category) || 0) + 1);
  const winners = result ? result.winners ?? (result.winner === null ? [] : [result.winner]) : [];
  const outcome = !result ? status === "incomplete" ? "incomplete" : "in progress"
    : !winners.length ? "draw" : !winners.includes(player) ? "lost" : winners.length > 1 ? "shared win" : "won";
  return { player, matchDecisionCount: moves.length, yourDecisionCount: personal.length,
    actionCounts: Object.fromEntries(counts), outcome, finalScore: result?.scores?.[player - 1] ?? null,
    gameMetrics: observation?.metrics ?? {} };
}

async function atomicJson(file, value) {
  await fs.writeFile(`${file}.tmp`, JSON.stringify(value, null, 2));
  await fs.rename(`${file}.tmp`, file);
}

export function renderReport(metadata, moves, reflections) {
  const lines = [`# ${metadata.game || "Game"} — LLM playtest`, "",
    `Status: **${metadata.status}**. Decisions played: ${moves.length}.`,
    `Model: ${metadata.provider} / ${metadata.model}.`,
    `Result: ${JSON.stringify(metadata.result ?? null)}.`,
    metadata.reason ? `Stopped because: ${metadata.reason}` : "",
    `Feedback: ${metadata.feedbackStatus}.`, "",
    ...(metadata.agentOptions ? [`Agent features: planning **${metadata.agentOptions.planning ? "on" : "off"}**; endgame guidance **${metadata.agentOptions.endgameAwareness ? "on" : "off"}**.`, ""] : []),
    "These are simulated player reactions from one run, not evidence of human enjoyment or game balance.",
    "Recorded facts and selected actions come from the engine and runner. Subjective reflections and explanations are unverified agent opinions.",
    "This organizer report and transcript can contain private player information. Do not feed them to opponents during play.", "",
    ...renderDiagnostics(metadata), "## Player reflections", ""];
  for (const player of metadata.seats || []) {
    lines.push(`### Player ${player.player}: ${player.name}`, "");
    const facts = metadata.statistics?.players.find((item) => item.player === player.player);
    if (facts) lines.push("**Recorded facts**", "",
      `Personal decisions: **${facts.yourDecisionCount}**. Match decisions: **${facts.matchDecisionCount}**.`, "",
      `Action counts: ${JSON.stringify(facts.actionCounts)}.`, "",
      `Outcome: ${facts.outcome}. Final score: ${facts.finalScore ?? "not provided by engine result"}.`, "",
      `Game metrics: ${JSON.stringify(facts.gameMetrics)}.`, "");
    lines.push("**Subjective reflection (unverified)**", "");
    const reflection = reflections.find((item) => item.player === player.player);
    if (!reflection?.feedback) lines.push(`Feedback unavailable: ${reflection?.error || "not collected yet"}.`, "");
    else for (const field of reflectionFields) lines.push(`**${field}:** ${reflection.feedback[field]}`, "");
  }
  lines.push("## Turn commentary", "");
  for (const move of moves) {
    lines.push(`### Decision ${move.decision} — Player ${move.player}`, "",
      `**Selected action: ${move.action.label}**`, "",
      `Recorded move: ${JSON.stringify(move.move)}${move.publicEvent ? ` — ${move.publicEvent}` : ""}`, "",
      `Agent feeling (subjective): ${move.feeling}`, "", `Agent explanation (unverified): ${move.reason}`, "");
    if (Object.hasOwn(move, "plan")) lines.push(`Previous tentative plan: ${JSON.stringify(move.previousPlan ?? null)}`, "",
      `Updated tentative plan (unverified): ${JSON.stringify(move.plan)}`, "");
  }
  return lines.join("\n");
}

// agentFactory and onEvent are injectable so tests and a future live visualizer use the same loop.
export async function runPlaytest({ engine, agentFactory, outDir, rules, players = engine.info.players,
  provider = "custom", model = "custom", maxMoves = 500, maxMinutes = 30, timeoutMs = 60_000,
  retries = 2, maxPromptChars = 100_000, planning = false, endgameAwareness = false, signal, onEvent = () => {}, provenance = {} }) {
  if (typeof planning !== "boolean" || typeof endgameAwareness !== "boolean") throw new Error("Agent feature toggles must be booleans");
  if (!Number.isSafeInteger(players) || players < engine.info.minPlayers || players > engine.info.maxPlayers) {
    throw new Error(`Player count must be between ${engine.info.minPlayers} and ${engine.info.maxPlayers}`);
  }
  for (const [key, value] of Object.entries({ maxMoves, timeoutMs, maxPromptChars })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${key} must be a positive integer`);
  }
  if (!Number.isFinite(maxMinutes) || maxMinutes <= 0) throw new Error("maxMinutes must be positive");
  if (!Number.isSafeInteger(retries) || retries < 0) throw new Error("retries must be a nonnegative integer");
  await fs.mkdir(outDir, { recursive: true });
  // Refuse to mix a new match with existing events.
  const log = await fs.open(path.join(outDir, "transcript.jsonl"), "wx");
  const metadata = { schemaVersion: 2, ...provenance, game: engine.info.name, provider, model, players,
    startedAt: new Date().toISOString(), status: "running", feedbackStatus: "pending", result: null,
    limits: { maxMoves, maxMinutes, timeoutMs, retries, maxPromptChars },
    agentOptions: { planning, endgameAwareness },
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0, requestsWithoutUsage: 0 },
    seats: Array.from({ length: players }, (_, i) => ({ player: i + 1, name: engine.info.playerNames?.[i] || `Player ${i + 1}` })) };
  const agents = metadata.seats.map((seat) => ({ ...seat, agent: agentFactory(seat.player), facts: [], commentary: [], observation: null, plan: null }));
  const moves = [], reflections = [];
  const replay = { schemaVersion: 1, game: metadata.game, players, initialState: null, moves: [], finalState: null, result: null };
  const deadline = Date.now() + maxMinutes * 60_000;
  let sequence = 0;
  const diagnosticEvents = [];
  const emit = async (type, data = {}) => {
    const event = { schemaVersion: 2, sequence: ++sequence, at: new Date().toISOString(), type, ...data };
    await log.write(`${JSON.stringify(event)}\n`);
    if (["agent_deciding", "agent_response", "agent_error"].includes(type)) diagnosticEvents.push(event);
    if (type === "move_accepted") diagnosticEvents.push({ type, player: data.player, decision: data.decision });
    if (type === "reflection_received") diagnosticEvents.push({ type, player: data.player, feedback: !!data.feedback });
    await onEvent(copy(event));
  };
  const save = async () => {
    metadata.diagnostics = summarizeDiagnostics(diagnosticEvents);
    metadata.statistics = { matchDecisionCount: moves.length,
      players: agents.map((seat) => playerFacts(seat.player, moves, metadata.result, seat.observation, metadata.status)) };
    await atomicJson(path.join(outDir, "replay.json"), replay);
    await atomicJson(path.join(outDir, "metadata.json"), { ...metadata, decisions: moves.length });
    await fs.writeFile(path.join(outDir, "report.md"), renderReport(metadata, moves, reflections));
  };
  const ask = async (seat, kind, input) => {
    if (JSON.stringify(input).length > maxPromptChars) throw new Error("Agent input exceeds maxPromptChars; reduce state/move size or increase the limit");
    let correction;
    for (let attempt = 0; attempt <= retries; attempt++) {
      signal?.throwIfAborted();
      const remaining = kind === "move" ? deadline - Date.now() : timeoutMs;
      if (remaining <= 0) throw new Error("Playtest time limit reached");
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => controller.abort(new Error("Agent response timed out")), Math.min(timeoutMs, remaining));
      const started = Date.now();
      let usageRecorded = false;
      let response;
      let stage = "request";
      const requestId = metadata.usage.requests + 1;
      const decision = kind === "move" ? input.matchDecisionNumber : null;
      try {
        metadata.usage.requests++;
        let abortHandler;
        const aborted = new Promise((_, reject) => {
          abortHandler = () => reject(controller.signal.reason);
          controller.signal.addEventListener("abort", abortHandler, { once: true });
        });
        try {
          response = await Promise.race([seat.agent.respond(kind, copy(input), { signal: controller.signal, correction }), aborted]);
        } finally { controller.signal.removeEventListener("abort", abortHandler); }
        const usage = response.usage;
        if (usage && Number.isFinite(usage.total_tokens)) {
          usageRecorded = true;
          metadata.usage.inputTokens += usage.input_tokens || 0;
          metadata.usage.outputTokens += usage.output_tokens || 0;
          metadata.usage.totalTokens += usage.total_tokens;
        }
        await emit("agent_response", { requestId, decision, player: seat.player, kind, attempt: attempt + 1,
          elapsedMs: Date.now() - started, usage: usage || null, finishReason: response.finishReason ?? null });
        stage = "response_validation";
        return parseAgentReply(response.raw, kind, input.legalMoves, { planning });
      } catch (error) {
        correction = String(error.message || error).slice(0, 500);
        await emit("agent_error", { requestId, decision, player: seat.player, kind, attempt: attempt + 1,
          stage, code: error.code ?? null, error: correction, elapsedMs: Date.now() - started,
          rawResponse: response?.raw ?? null, finishReason: response?.finishReason ?? null, usage: response?.usage ?? null });
        await save();
        if (attempt === retries || signal?.aborted) throw new Error(`Player ${seat.player} ${kind} failed: ${correction}`);
      } finally {
        if (!usageRecorded) metadata.usage.requestsWithoutUsage++;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    }
  };
  const observedState = (state, player) => withoutSeeds(engine.info.hasObserve ? engine.call("observe", state, player) : copy(state));
  const observe = (state, seat) => checkAgentObservation(engine.call("agentObservation", observedState(state, seat.player), seat.player), seat.player);
  const historyFor = (seat, reflection = false) => ({
    recordedFacts: playerFacts(seat.player, moves, metadata.result, seat.observation, metadata.status),
    factualHistory: boundedHistory(seat.facts, reflection ? 8000 : 3000),
    ...(reflection ? { subjectiveCommentary: boundedHistory(seat.commentary, 4000) } : {}),
    ...(reflection && planning ? { lastPlan: copy(seat.plan) } : {}),
  });
  let gameContext;
  let state;
  try {
    try {
      gameContext = checkAgentContext(engine.call("agentContext"));
      await atomicJson(path.join(outDir, "agent-context.json"), gameContext);
      state = engine.call("initialState", players);
      if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("initialState must return an object");
      replay.initialState = copy(state);
      replay.finalState = copy(state);
      for (const seat of agents) seat.observation = observe(state, seat);
      await emit("game_started", { game: metadata.game, players, seats: metadata.seats, provider, model });
      await save();
      for (;;) {
        metadata.result = checkedResult(engine.call("result", state), players);
        if (metadata.result) { metadata.status = "complete"; break; }
        signal?.throwIfAborted();
        if (moves.length >= maxMoves) throw new Error(`Move limit reached (${maxMoves})`);
        if (Date.now() >= deadline) throw new Error("Playtest time limit reached");
        const player = engine.call("currentPlayer", state);
        if (!Number.isSafeInteger(player) || player < 1 || player > players) throw new Error("Invalid currentPlayer");
        const seat = agents[player - 1];
        const legal = engine.call("legalMoves", state);
        if (!Array.isArray(legal) || !legal.length) throw new Error("No legal moves in an unfinished game");
        const decision = moves.length + 1;
        const seen = observedState(state, player);
        const legalMoves = legal.map((move, index) => ({ id: `d${decision}-m${index + 1}`,
          ...checkAgentAction(engine.call("describeAction", seen, move, player)) }));
        await emit("agent_deciding", { player, decision });
        // End the prompt with current facts and executable choices, not earlier beliefs.
        const availableActionCounts = Object.fromEntries([...new Set(legalMoves.map(action => action.category))]
          .map(category => [category, legalMoves.filter(action => action.category === category).length]));
        const input = { rules, gameContext, player, name: seat.name, players, matchDecisionNumber: decision,
          yourDecisionNumber: seat.commentary.length + 1, ...historyFor(seat),
          ...(planning || endgameAwareness ? { agentOptions: { planning, endgameAwareness } } : {}),
          ...(planning ? { previousPlan: copy(seat.plan) } : {}),
          ...(endgameAwareness ? { endgameGuidance: { source: seat.observation.endgame ? "observation.endgame" : "rules-and-observation",
            facts: seat.observation.endgame ?? null,
            note: "Use the supplied game rules and current observation. Missing countdowns are unknown; do not infer them from playtest limits." } } : {}),
          observation: seat.observation, availableActionCounts, legalMoves };
        const reply = await ask(seat, "move", input);
        const selectedIndex = legalMoves.findIndex((item) => item.id === reply.moveId);
        const action = legalMoves[selectedIndex];
        const move = copy(legal[selectedIndex]);
        const next = engine.call("applyMove", state, move);
        if (!next || typeof next !== "object" || Array.isArray(next)) throw new Error("applyMove must return an object");
        if (!isDeepStrictEqual(next, engine.call("applyMove", state, move))) throw new Error("applyMove is not deterministic");
        const publicEvent = engine.info.hasDescription ? engine.call("describeMove", state, move) : `Player ${player} acted at decision ${decision}.`;
        if (typeof publicEvent !== "string") throw new Error("describeMove must return a string");
        const record = { decision, player, move, action, ...reply, observation: seat.observation, publicEvent,
          ...(planning ? { previousPlan: copy(seat.plan) } : {}),
          ...(endgameAwareness ? { endgameGuidance: copy(input.endgameGuidance) } : {}) };
        if (planning) seat.plan = reply.plan === null ? null : { decision, plan: copy(reply.plan) };
        // Opinions never enter factual memory or the calculated statistics.
        seat.commentary.push({ decision, feeling: reply.feeling, reason: reply.reason });
        moves.push(record);
        replay.moves.push({ decision, player, move: copy(move) });
        state = next;
        replay.finalState = copy(state);
        await emit("move_accepted", record);
        // Never give opponents the raw move or this player's private explanation.
        for (const other of agents) {
          const observation = observe(state, other);
          const event = { decision, player, publicEvent, ...observationChanges(other.observation, observation) };
          if (other.player === player) event.selectedAction = action.label;
          other.facts.push(event);
          other.observation = observation;
          await emit("player_observed", { viewer: other.player, ...event });
        }
        await save();
      }
    } catch (error) {
      metadata.status = "incomplete";
      metadata.reason = String(error.message || error);
    }
    metadata.playEndedAt = new Date().toISOString();
    replay.result = metadata.result;
    await emit("game_ended", { status: metadata.status, reason: metadata.reason, result: metadata.result, decisions: moves.length });
    await save();
    // Every seat reflects, including eliminated players. Each uses only its own observation/history.
    for (const seat of agents) {
      let record;
      try {
        if (replay.initialState === null) throw new Error("Game did not initialize");
        if (!seat.observation || !gameContext) throw new Error("Readable agent context was not initialized");
        const feedback = await ask(seat, "reflection", { rules, gameContext, player: seat.player, name: seat.name, players,
          status: metadata.status, reason: metadata.reason, result: metadata.result,
          observation: seat.observation, ...historyFor(seat, true) });
        record = { player: seat.player, feedback };
      } catch (error) { record = { player: seat.player, error: String(error.message || error) }; }
      reflections.push(record);
      await emit("reflection_received", record);
      await save();
    }
    metadata.feedbackStatus = reflections.every((record) => record.feedback) ? "complete" : "partial";
    metadata.finishedAt = new Date().toISOString();
    await emit("run_finished", { status: metadata.status, feedbackStatus: metadata.feedbackStatus });
    await save();
    return { metadata, moves, reflections, replay, outDir };
  } finally { await log.close(); }
}
