import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import { buildReplayViewer } from "./replay.js";

const code = `
window.GameEngine = {
  name: 'Replay fixture', players: 2, hidden: true, playerNames: ['Red','Blue'], rules: 'Reach two.',
  initialState() { throw new Error('Do not regenerate setup'); },
  currentPlayer(s) { return s.total % 2 + 1; },
  legalMoves(s) { return s.total >= 2 ? [] : [{ add: 1 }]; },
  applyMove(s, m) { return {...s, total: s.total + m.add}; },
  result(s) { return s.total >= 2 ? {winner: 2, scores:[0,2]} : null; },
  observe(s,p) { return {...s, hands:s.hands.map((h,i)=>i===p-1?h:null)}; }
};
window.GameView = { mount(container, ctx) {
  return { update(s,info) {
    window.lastUpdate = {state:s,info}; container.textContent = 'Total: ' + s.total;
    const b=document.createElement('button'); b.textContent='Attempt play';
    b.onclick=()=>{window.playResult=ctx.play({add:1});};container.append(b);
  }};
}};`;

async function fixture(t, { partial = false, transcript = true, plans = false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "replay-viewer-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const initialState = { total: 0, hands: ["red secret", "blue secret"] };
  const moves = [{ decision: 1, player: 1, move: { add: 1 } }, { decision: 2, player: 2, move: { add: 1 } }].slice(0, partial ? 1 : 2);
  const replay = { players: 2, initialState, moves, finalState: { ...initialState, total: moves.length }, result: partial ? null : { winner: 2, scores: [0, 2] } };
  await fs.writeFile(path.join(dir, "game.js"), code);
  await fs.writeFile(path.join(dir, "replay.json"), JSON.stringify(replay));
  await fs.writeFile(path.join(dir, "metadata.json"), JSON.stringify({ status: partial ? "incomplete" : "complete", reason: partial ? "Move limit reached" : undefined }));
  if (transcript) {
    const events = [
      { type: "agent_deciding", decision: 1 },
      { type: "agent_error", player: 1, kind: "move", attempt: 1, error: "moveId is missing" },
      ...moves.map(m => ({ ...m, type: "move_accepted", action: { label: `Private action ${m.player}` }, publicEvent: "Advanced", feeling: `Private feeling ${m.player}`, reason: '</script><script>window.injected=true</script>',
        ...(plans ? { previousPlan: null, plan: m.player === 1 ? { goal: "Private route </script><script>window.injected=true</script>", steps: ["Advance"], reconsiderIf: "Blocked", horizon: "Unknown" } : null } : {}) })),
      { type: "reflection_received", player: 1, feedback: { summary: "Red reflection" } },
      { type: "reflection_received", player: 2, feedback: { summary: "Blue reflection" } },
    ];
    await fs.writeFile(path.join(dir, "transcript.jsonl"), events.map(e => JSON.stringify(e)).join("\n"));
  }
  return { dir, replay };
}

async function open(t, dir, { build = true } = {}) {
  const file = build ? await buildReplayViewer(path.join(dir, "replay.json")) : path.join(dir, "replay.html");
  const errors = [], virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", e => errors.push(e.message));
  const dom = new JSDOM(await fs.readFile(file, "utf8"), { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
    url: pathToFileURL(file).href, virtualConsole });
  t.after(() => dom.window.close());
  await new Promise(resolve => dom.window.addEventListener("load", resolve, { once: true }));
  return { window: dom.window, errors, $: id => dom.window.document.getElementById(id) };
}

test("shared HTML works alone and preserves embedded source and report text safely", async t => {
  const { dir } = await fixture(t, { plans: true });
  const tricky = 'Unicode café 🌸 </ScRiPt><script>window.injected=true</script> <!-- REPLAY_DATA /* REPLAY_CONTROLLER */';
  await fs.appendFile(path.join(dir, "game.js"), `\nwindow.embeddedText = ${JSON.stringify(tricky)};`);
  await fs.writeFile(path.join(dir, "report.md"), `# Report\n${tricky}`);
  const file = await buildReplayViewer(dir);
  const shared = path.join(dir, "shared");
  await fs.mkdir(shared);
  await fs.copyFile(file, path.join(shared, "replay.html"));
  assert.deepEqual(await fs.readdir(shared), ["replay.html"]);
  const { window, $, errors } = await open(t, shared, { build: false });
  assert.deepEqual(errors, []);
  assert.equal($("fatal").hidden, true);
  assert.equal(window.embeddedText, tricky);
  assert.equal(window.injected, undefined);
  assert.equal(window.document.querySelectorAll("script[src]").length, 0);
  $("next").click();
  assert.match($("plan").textContent, /Private route/);
  $("last").click();
  assert.equal(window.lastUpdate.state.total, 2);
  assert.match($("reflections").textContent, /Red reflection/);
  $("report-link").click();
  assert.equal($("saved-report").open, true);
  assert.equal($("report-text").textContent, `# Report\n${tricky}`);
});

test("offline viewer steps, seeks, shows before/after, and cannot make new moves", async t => {
  const { dir } = await fixture(t);
  const { window, $, errors } = await open(t, dir);
  assert.deepEqual(errors, []);
  assert.equal($("fatal").hidden, true);
  assert.equal(window.GameReplay.position, 0);
  $("next").click();
  assert.equal(window.lastUpdate.state.total, 1);
  assert.equal(window.lastUpdate.info.canMove, false);
  assert.equal(window.lastUpdate.info.legalMoves.length, 0);
  assert.equal($("action").textContent, "Private action 1");
  assert.match($("errors").textContent, /moveId is missing/);
  assert.equal(window.injected, undefined);
  assert.match($("reason").textContent, /<script>/);
  window.document.querySelector("#board button").click();
  assert.equal(window.playResult, false);
  assert.equal(window.GameReplay.getState().total, 1);
  $("before").click();
  assert.equal(window.lastUpdate.state.total, 0);
  assert.match($("position").textContent, /Before decision 1/);
  $("before").click();
  $("last").click();
  assert.equal(window.GameReplay.position, 2);
  assert.match($("status").textContent, /Blue won/);
  assert.equal($("reflection-card").hidden, false);
  assert.match($("reflections").textContent, /Red reflection/);
  $("seek").value = "1"; $("seek").dispatchEvent(new window.Event("input"));
  assert.equal(window.GameReplay.position, 1);
  $("first").click();
  assert.equal(window.GameReplay.position, 0);
});

test("player perspectives mask hidden cards, last moves, labels, commentary, and reflections", async t => {
  const { dir } = await fixture(t);
  const { window, $ } = await open(t, dir);
  $("last").click();
  $("perspective").value = "1"; $("perspective").dispatchEvent(new window.Event("change"));
  assert.equal(window.lastUpdate.state.hands[1], null);
  assert.equal(window.lastUpdate.state.hands[0], "red secret");
  assert.equal(window.lastUpdate.info.lastMove, null);
  assert.equal($("action").textContent, "Advanced");
  assert.doesNotMatch($("timeline").textContent, /Private action 2/);
  assert.doesNotMatch($("feeling").textContent, /Private feeling 2/);
  assert.doesNotMatch($("reflections").textContent, /Blue reflection/);
  $("perspective").value = "all"; $("perspective").dispatchEvent(new window.Event("change"));
  assert.equal(window.lastUpdate.state.hands[1], "blue secret");
});

test("playback advances, pauses, and stops at the final recorded move", async t => {
  const { dir } = await fixture(t);
  const { window, $ } = await open(t, dir);
  // Control only the viewer's timer, avoiding wall-clock sleeps in this UI test.
  const pending = new Map(); let id = 0;
  window.setTimeout = fn => { pending.set(++id, fn); return id; };
  window.clearTimeout = handle => pending.delete(handle);
  const tick = () => { const [handle, fn] = pending.entries().next().value; pending.delete(handle); fn(); };
  $("toggle").click(); tick();
  assert.equal(window.GameReplay.position, 1);
  $("toggle").click(); assert.equal(pending.size, 0);
  $("toggle").click(); tick();
  assert.equal(window.GameReplay.position, 2);
  assert.equal($("toggle").textContent, "Play");
  assert.equal(pending.size, 0);
});

test("partial recordings without a transcript are watchable without claiming a winner", async t => {
  const { dir } = await fixture(t, { partial: true, transcript: false });
  const { $, errors } = await open(t, dir);
  $("last").click();
  assert.deepEqual(errors, []);
  assert.match($("status").textContent, /End of recording.*incomplete/);
  assert.match($("reason").textContent, /No explanation/);
});

test("corrupt replay state and wrong archived source fail visibly", async t => {
  const { dir, replay } = await fixture(t);
  replay.finalState.total = 99;
  await fs.writeFile(path.join(dir, "replay.json"), JSON.stringify(replay));
  const { $ } = await open(t, dir);
  assert.equal($("fatal").hidden, false);
  assert.match($("fatal").textContent, /final state does not match/);
  assert.equal($("toggle").disabled, true);
  await fs.writeFile(path.join(dir, "metadata.json"), JSON.stringify({ gameSha256: "wrong" }));
  await assert.rejects(buildReplayViewer(dir), /recorded hash/);
});

test("replay displays tentative plans safely and hides them from other player perspectives", async t => {
  const { dir } = await fixture(t, { plans: true });
  const { window, $ } = await open(t, dir);
  $("next").click();
  assert.equal($("plan-card").hidden, false);
  assert.match($("plan").textContent, /Private route/);
  assert.equal(window.injected, undefined);
  $("perspective").value = "2"; $("perspective").dispatchEvent(new window.Event("change"));
  assert.doesNotMatch($("plan").textContent, /Private route/);
  $("last").click();
  assert.match($("plan").textContent, /Abandoned/);
});
