(function () {
  const $ = id => document.getElementById(id);
  const copy = value => JSON.parse(JSON.stringify(value));
  const canonical = value => JSON.stringify(value, function (key, item) {
    return item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item;
  });
  let timer = null;
  const pause = () => { clearTimeout(timer); timer = null; $("toggle").textContent = "Play"; };
  function fail(error) {
    pause();
    $("fatal").hidden = false;
    $("fatal").textContent = `Unable to display replay: ${error.message || error}`;
    document.querySelectorAll("button, input, select").forEach(el => { el.disabled = true; });
  }
  window.addEventListener("error", event => fail(event.error || event.message));
  try {
    const data = JSON.parse($("replay-data").textContent);
    const { replay, metadata } = data;
    const engine = window.GameEngine, view = window.GameView;
    if (!engine || !view) throw new Error("The embedded game code could not be loaded. Rebuild replay.html from the saved match.");
    if (engine.hidden && typeof engine.observe !== "function") throw new Error("Hidden game has no player observation function");
    const names = Array.from({ length: replay.players }, (_, i) => engine.playerNames?.[i] || `Player ${i + 1}`);
    const palette = ["#e5484d", "#3b6fd8", "#d49f00", "#2fa36b", "#9b51e0", "#f07c2a", "#14a3b8", "#d6409f"];
    const colors = names.map((_, i) => engine.playerColors?.[i] || palette[i % palette.length]);
    const records = new Map(data.records.map(record => [record.decision, record]));
    const states = [copy(replay.initialState)], steps = [];
    // Start from the recorded state, never initialState(): setup randomness must not change.
    for (const [i, entry] of replay.moves.entries()) {
      const state = states[i], decision = i + 1;
      if (engine.result(copy(state))) throw new Error(`Recorded move ${decision} occurs after the game ended`);
      if (entry.player !== engine.currentPlayer(copy(state))) throw new Error(`Wrong player at decision ${decision}`);
      const legal = engine.legalMoves(copy(state));
      if (!legal.some(move => canonical(move) === canonical(entry.move))) throw new Error(`Illegal recorded move at decision ${decision}`);
      const next = engine.applyMove(copy(state), copy(entry.move));
      if (!next || typeof next !== "object") throw new Error(`Invalid state after decision ${decision}`);
      const record = records.get(decision);
      if (record && (record.player !== entry.player || canonical(record.move) !== canonical(entry.move))) {
        throw new Error(`Transcript and replay disagree at decision ${decision}`);
      }
      states.push(copy(next));
      steps.push({ ...entry, decision, action: record?.action?.label,
        publicEvent: record?.publicEvent || (engine.describeMove ? String(engine.describeMove(copy(state), copy(entry.move))) : `${names[entry.player - 1]} made a move`),
        feeling: record?.feeling, reason: record?.reason, hasPlan: record ? Object.hasOwn(record, "plan") : false,
        plan: record?.plan, previousPlan: record?.previousPlan });
    }
    if (replay.finalState && canonical(states.at(-1)) !== canonical(replay.finalState)) throw new Error("Reconstructed final state does not match replay.json");
    if (Object.hasOwn(replay, "result") && canonical(engine.result(copy(states.at(-1))) ?? null) !== canonical(replay.result)) {
      throw new Error("Reconstructed result does not match replay.json");
    }
    let position = 0, viewer = null;
    const board = view.mount($("board"), { play: () => false, engine, names, colors, kit: window.GameKit });
    $("title").textContent = `${engine.name || replay.game} — Replay`;
    document.title = $("title").textContent;
    $("subtitle").textContent = `${steps.length} recorded decisions · ${metadata.status || "saved replay"}${metadata.model ? ` · ${metadata.model}` : ""}`;
    $("rules").textContent = engine.rules || "Rules unavailable";
    $("report-link").hidden = $("saved-report").hidden = typeof data.report !== "string";
    $("report-text").textContent = data.report ?? "";
    $("report-link").addEventListener("click", () => { $("saved-report").open = true; });
    $("seek").max = String(steps.length);
    for (const [value, label] of [["all", "All players (spectator)"], ...names.map((name, i) => [String(i + 1), `${i + 1}: ${name}`])]) {
      const option = document.createElement("option"); option.value = value; option.textContent = label; $("perspective").append(option);
    }
    const visible = player => viewer === null || viewer === player;
    const resultText = result => {
      const winners = result.winners || (result.winner == null ? [] : [result.winner]);
      return `${winners.length ? `${winners.map(p => names[p - 1]).join(" & ")} won` : "Draw"}${result.scores ? ` · Scores: ${result.scores.map((s, i) => `${names[i]} ${s}`).join(", ")}` : ""}`;
    };
    function render() {
      const before = $("before").checked && position > 0;
      const stateIndex = before ? position - 1 : position;
      const state = states[stateIndex], result = engine.result(copy(state)) || null;
      const player = result ? null : engine.currentPlayer(copy(state));
      const last = steps[stateIndex - 1];
      const shown = engine.hidden && viewer !== null ? engine.observe(copy(state), viewer) : copy(state);
      board.update(shown, { canMove: false, legalMoves: [], player, viewer, players: replay.players,
        lastMove: last && (!engine.hidden || visible(last.player)) ? copy(last.move) : null, result: copy(result) });
      $("position").textContent = position === 0 ? `Setup · 0 / ${steps.length}` : `${before ? "Before" : "After"} decision ${position} / ${steps.length}`;
      $("status").textContent = result ? resultText(result) : stateIndex === steps.length
        ? `End of recording · ${metadata.status || "unfinished"}${metadata.reason ? `: ${metadata.reason}` : ""}` : `${names[player - 1]} to decide`;
      $("seek").value = String(position);
      $("before").disabled = position === 0;
      $("previous").disabled = $("first").disabled = position === 0;
      $("next").disabled = $("last").disabled = position === steps.length;
      $("toggle").disabled = steps.length === 0;
      $("perspective-note").textContent = viewer === null ? "Organizer view: includes private cards and all agents’ commentary."
        : `${names[viewer - 1]}'s board perspective and private commentary. Other agents’ explanations are hidden.`;
      const step = steps[position - 1];
      $("commentary-heading").textContent = step ? `Decision ${position} · ${names[step.player - 1]}` : "Initial setup";
      $("action").textContent = step ? (visible(step.player) ? step.action || step.publicEvent : step.publicEvent) : "Choose Play or Next to watch the recorded game.";
      $("feeling").textContent = step && visible(step.player) ? step.feeling || "No commentary recorded." : step ? "Private commentary hidden." : "—";
      $("reason").textContent = step && visible(step.player) ? step.reason || "No explanation recorded." : step ? "Private commentary hidden." : "—";
      $("plan-card").hidden = !step?.hasPlan;
      $("plan").textContent = step?.hasPlan && visible(step.player)
        ? `Previous intention:\n${step.previousPlan ? JSON.stringify(step.previousPlan, null, 2) : "None"}\n\nUpdated plan (after this action):\n${step.plan ? JSON.stringify(step.plan, null, 2) : "Abandoned; no replacement plan."}`
        : "Private plan hidden.";
      const errors = data.errors.filter(e => e.kind === "move" && e.decision === position && visible(e.player));
      $("errors").textContent = errors.length ? `Request errors before this move (${errors.length}):\n${errors.map(e => `Attempt ${e.attempt}: ${e.error}${e.recovered ? " (recovered)" : ""}`).join("\n")}` : "";
      $("timeline").replaceChildren();
      for (const item of steps) {
        const li = document.createElement("li"), button = document.createElement("button");
        button.textContent = `${item.decision}. ${names[item.player - 1]} · ${visible(item.player) ? item.action || item.publicEvent : item.publicEvent}`;
        button.setAttribute("aria-current", String(item.decision === position));
        button.addEventListener("click", () => seek(item.decision)); li.append(button); $("timeline").append(li);
      }
      $("reflections").replaceChildren();
      $("reflection-card").hidden = position !== steps.length || before || !data.reflections.length;
      for (const reflection of data.reflections.filter(r => visible(r.player))) {
        const article = document.createElement("article"), title = document.createElement("h2");
        title.textContent = names[reflection.player - 1]; article.append(title);
        for (const [key, value] of Object.entries(reflection.feedback || { error: reflection.error || "Feedback unavailable" })) {
          const p = document.createElement("p"), label = document.createElement("strong"); label.textContent = `${key}: `;
          p.append(label, document.createTextNode(String(value))); article.append(p);
        }
        $("reflections").append(article);
      }
    }
    function seek(index) {
      pause();
      position = Math.max(0, Math.min(steps.length, Math.trunc(Number(index)) || 0));
      try { render(); } catch (error) { fail(error); }
    }
    function play() {
      if (timer !== null) { pause(); return; }
      if (!steps.length) return;
      if (position === steps.length) position = 0;
      $("before").checked = false;
      $("toggle").textContent = "Pause";
      const tick = () => {
        if (position < steps.length) position++;
        try { render(); } catch (error) { fail(error); return; }
        if (position === steps.length) pause();
        else timer = setTimeout(tick, Number($("speed").value));
      };
      try { render(); } catch (error) { fail(error); return; }
      timer = setTimeout(tick, Number($("speed").value));
    }
    $("toggle").addEventListener("click", play);
    $("first").addEventListener("click", () => seek(0));
    $("previous").addEventListener("click", () => seek(position - 1));
    $("next").addEventListener("click", () => seek(position + 1));
    $("last").addEventListener("click", () => seek(steps.length));
    $("seek").addEventListener("input", event => seek(event.target.value));
    $("before").addEventListener("change", () => seek(position));
    $("perspective").addEventListener("change", () => { viewer = $("perspective").value === "all" ? null : Number($("perspective").value); seek(position); });
    $("speed").addEventListener("change", () => { if (timer !== null) { pause(); play(); } });
    document.addEventListener("keydown", event => {
      if (["INPUT", "SELECT", "TEXTAREA", "BUTTON", "A"].includes(event.target.tagName)) return;
      if (["ArrowLeft", "ArrowRight", " "].includes(event.key)) {
        event.preventDefault();
        if (event.key === " ") play(); else seek(position + (event.key === "ArrowRight" ? 1 : -1));
      }
    });
    window.addEventListener("pagehide", pause);
    window.GameReplay = { seek, pause, get position() { return position; }, getState: () => copy(states[position]) };
    render();
  } catch (error) { fail(error); }
})();
