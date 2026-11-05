import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateHtml, repairFeedback } from "./htmlRunner.js";
import { extractHtml } from "./repairLoop.js";

const document = script => `<!DOCTYPE html><html><head><title>Test</title></head><body><canvas></canvas><script>${script}</script></body></html>`;
async function candidate(t, html) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "html-validation-"));
  const file = path.join(dir, "game.html");
  await fs.writeFile(file, html);
  t.after(async () => { await fs.unlink(file); await fs.rmdir(dir); });
  return file;
}

test("extracts fenced and raw HTML", () => {
  assert.equal(extractHtml("```html\n<!DOCTYPE html>\n```"), "<!DOCTYPE html>");
  assert.equal(extractHtml(" <html></html> "), "<html></html>");
});
test("rejects incomplete documents before launching a browser", async t => {
  assert.equal((await validateHtml(await candidate(t, "<script></script>"))).stage, "document");
  assert.equal((await validateHtml("game.lud")).stage, "input");
  assert.equal(repairFeedback({ ok: false, stage: "setup", errors: [] }), null);
});
test("live server accepts working JavaScript and reports syntax, runtime, input and resource errors", async t => {
  for (const [name, script, ok] of [
    ["valid", 'const ctx = document.querySelector("canvas").getContext("2d"); function draw() { ctx.fillRect(0,0,10,10); requestAnimationFrame(draw); } draw();', true],
    ["syntax", "const x = ;", false],
    ["runtime", 'throw new Error("broken startup")', false],
    ["input", 'addEventListener("keydown", () => { throw new Error("broken controls"); });', false],
    ["external", 'fetch("https://example.com/asset.json");', false],
    ["missing", 'fetch("missing.js");', false],
  ]) {
    await t.test(name, async t => {
      const result = await validateHtml(await candidate(t, document(script)), { smokeMs: 50 });
      assert.equal(result.ok, ok, JSON.stringify(result));
      assert.equal(result.stage, ok ? "complete" : "browser", JSON.stringify(result));
    });
  }
});

test("a blocking script is bounded by the validation timeout", async t => {
  const file = await candidate(t, document("while (true) {}"));
  const result = await validateHtml(file, { timeoutMs: 2000, smokeMs: 0 });
  assert.equal(result.ok, false);
  assert.ok(["timeout", "browser"].includes(result.stage), JSON.stringify(result));
});

test("design-specific controls are exercised and missing behaviors fail despite valid JavaScript", async t => {
  const html = `<!DOCTYPE html><html><head><title>Custom controls</title></head><body><canvas></canvas><script>
    const state = { tick: 0, player: { x: 0, y: 0 }, dashes: 1 };
    addEventListener('keydown', event => { if (event.key === 'k' && state.dashes > 0) { state.player.x += 30; state.dashes--; } });
    function loop() { state.tick++; requestAnimationFrame(loop); } loop();
    window.__gameTest = { snapshot: () => structuredClone(state) };
  </script></body></html>`;
  const file = await candidate(t, html);
  const scenario = { id: "dash", purpose: "Dash spends a charge and changes position", requirementIds: ["R1"], steps: [
    { action: "press", key: "k" }, { action: "wait", ms: 50 },
    { action: "assert", path: "player.x", op: "changed" }, { action: "assert", path: "dashes", op: "eq", value: 0 },
  ] };
  const result = await validateHtml(file, { playtests: [scenario], timeoutMs: 10000 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.playtests[0].checks.length, 2);
  const wrong = structuredClone(scenario); wrong.steps[0].key = "j";
  const failure = await validateHtml(file, { playtests: [wrong], timeoutMs: 10000 });
  assert.equal(failure.ok, false);
  assert.equal(failure.stage, "behavior");
  assert.match(failure.errors.join(" "), /player.x/);
  const missingApi = await validateHtml(await candidate(t, document("let x = 1;")), { playtests: [scenario], timeoutMs: 10000 });
  assert.equal(missingApi.stage, "behavior");
  assert.match(missingApi.errors.join(" "), /snapshot/);
});

test("behavior checks freeze time between assertions and isolate every scenario", async t => {
  const html = document(`
    const state = {tick:0,player:{x:0,y:0,vx:0},shots:0,heldX:0};
    const keys=new Set();
    addEventListener('keydown',e=>keys.add(e.code)); addEventListener('keyup',e=>keys.delete(e.code));
    function frame(){state.tick++;state.player.vx=keys.has('ArrowRight')?330:0;state.player.x+=state.player.vx/60;if(keys.has('ArrowRight')&&keys.has('KeyF'))state.shots++;if(keys.has('KeyX'))state.heldX++;requestAnimationFrame(frame);}requestAnimationFrame(frame);
    window.__gameTest={snapshot:()=>structuredClone(state)};
  `);
  const file = await candidate(t, html);
  const scenario = {id:"simultaneous",purpose:"Move and shoot simultaneously",requirementIds:["R1"],steps:[
    {action:"hold",keys:["ArrowRight","KeyF"],ms:200},
    {action:"assert",path:"player.vx",op:"eq",value:330},
    {action:"assert",path:"shots",op:"gt",value:0},
    {action:"assert",path:"player.vx",op:"eq",value:330},
    {action:"wait",ms:50},
    {action:"assert",path:"player.vx",op:"eq",value:0},
    {action:"down",key:"ArrowRight"},
    {action:"hold",key:"KeyF",ms:100},
    {action:"wait",ms:50},
    {action:"assert",path:"player.vx",op:"eq",value:330},
    {action:"up",key:"ArrowRight"},
    {action:"wait",ms:50},
    {action:"assert",path:"player.vx",op:"eq",value:0},
  ]};
  const failHeld = {id:"failure",purpose:"Fail while a key is held",requirementIds:["R1"],steps:[{action:"down",key:"KeyX"},{action:"wait",ms:50},{action:"assert",path:"shots",op:"eq",value:999}]};
  const clean = {id:"clean",purpose:"No leaked keys",requirementIds:["R1"],steps:[{action:"wait",ms:50},{action:"assert",path:"heldX",op:"eq",value:0}]};
  const result=await validateHtml(file,{playtests:[scenario,{...scenario,id:"repeat"},failHeld,clean],timeoutMs:15000});
  assert.equal(result.stage,"behavior");
  assert.equal(result.playtests[0].ok,true,JSON.stringify(result));
  assert.equal(result.playtests[1].ok,true);
  assert.deepEqual(result.playtests[0].before,result.playtests[1].before);
  assert.deepEqual(result.playtests[0].after,result.playtests[1].after);
  const trace=result.playtests[0].trace;
  assert.equal(trace[1].after.tick,trace[3].after.tick,"assertions must consume zero simulation time");
  assert.equal(result.playtests[2].ok,false);
  assert.equal(result.playtests[2].failedStep.index,2);
  assert.ok(result.playtests[2].after,"failed checks must preserve observed state");
  assert.equal(result.playtests[3].ok,true,"held keys must not leak across failed scenarios");
  assert.match(repairFeedback(result),/failedStep/);
  assert.match(repairFeedback(result),/recentSteps/);
});

test("isolated behavior pages still report JavaScript errors from real keyboard handlers", async t => {
  const file=await candidate(t,document(`
    window.__gameTest={snapshot:()=>({tick:1,player:{x:0,y:0}})};
    addEventListener('keydown',()=>{throw new Error('scenario keyboard failure')});
  `));
  const result=await validateHtml(file,{playtests:[{id:"runtime",purpose:"Input handler errors",requirementIds:["R1"],steps:[{action:"press",key:"k"},{action:"assert",path:"player.x",op:"eq",value:0}]}]});
  assert.equal(result.ok,false);
  assert.match(result.errors.join(' '),/scenario keyboard failure/);
});

test("behavior fixtures enter the requested level and retain normal keyboard/RAF execution", async t => {
  const code=`
    let level='level-1',started=false;
    let state={tick:0,player:{x:100,y:520,gravitySign:1},unlocked:1};
    const held=new Set();
    addEventListener('keydown',e=>{if(e.code==='Enter')started=true;held.add(e.code);if(started&&e.code==='KeyC'&&state.unlocked===5)state.player.gravitySign=-1;});
    addEventListener('keyup',e=>held.delete(e.code));
    function frame(){if(started){state.tick++;if(held.has('ArrowRight'))state.player.x+=5;}requestAnimationFrame(frame);}requestAnimationFrame(frame);
    function snapshot(){return structuredClone({...state,traversal:{levelId:level}});}
    window.__gameTest={snapshot,reset:({levelId})=>{level=levelId;state={tick:0,player:{x:100,y:520,gravitySign:1},unlocked:level==='level-1'?1:5};started=true;held.clear();return snapshot();}};
  `;
  const file=await candidate(t,document(code));
  const tests=[
    {id:'later',levelId:'level-2',purpose:'Later-level ability',requirementIds:['R1'],steps:[{action:'press',key:'KeyC'},{action:'hold',key:'ArrowRight',ms:100},{action:'assert',path:'player.gravitySign',op:'eq',value:-1},{action:'assert',path:'unlocked',op:'eq',value:5},{action:'assert',path:'player.x',op:'gt',value:100}]},
    {id:'entry',levelId:'level-1',purpose:'Fresh first-level state',requirementIds:['R1'],steps:[{action:'assert',path:'unlocked',op:'eq',value:1},{action:'assert',path:'player.x',op:'eq',value:100}]},
    {id:'normal',purpose:'Explicit title-screen start input',requirementIds:['R1'],steps:[{action:'press',key:'Enter'},{action:'hold',key:'ArrowRight',ms:100},{action:'assert',path:'player.x',op:'gt',value:100}]},
  ];
  const result=await validateHtml(file,{playtests:tests});
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(result.playtests[0].setup.actualLevel,'level-2');
  assert.equal(result.playtests[1].setup.actualLevel,'level-1');
  assert.ok(result.playtests[0].after.tick>result.playtests[0].before.tick);
});

test("requested level fixtures fail explicitly if setup is absent or ignored", async t => {
  const scenario={id:'later',levelId:'level-2',purpose:'Specific level',requirementIds:['R1'],steps:[{action:'assert',path:'player.x',op:'eq',value:100}]};
  for(const reset of ['',',reset:()=>{}']) {
    const file=await candidate(t,document(`window.__gameTest={snapshot:()=>({tick:0,player:{x:100,y:0},traversal:{levelId:'level-1'}})${reset}};`));
    const result=await validateHtml(file,{playtests:[scenario]});
    assert.equal(result.ok,false);
    assert.match(result.errors.join(' '),reset?/requested level-2, observed "level-1"/:/reset.*missing/);
    assert.equal(result.playtests[0].failedStep.phase,'initialization');
  }
});

test("a stalled title-screen scenario reports zero ticks rather than blaming movement tuning", async t => {
  const file=await candidate(t,document(`window.__gameTest={snapshot:()=>({tick:0,player:{x:100,y:0}})};`));
  const result=await validateHtml(file,{playtests:[{id:'stalled',purpose:'Movement',requirementIds:['R1'],steps:[{action:'hold',key:'ArrowRight',ms:100},{action:'assert',path:'player.x',op:'gt',value:100}]}]});
  assert.equal(result.ok,false);
  assert.equal(result.playtests[0].stalled,true);
  assert.match(result.errors.join(' '),/No simulation ticks advanced/);
  assert.match(repairFeedback(result),/title-screen/);
});
