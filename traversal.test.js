import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateHtml, repairFeedback } from "./htmlRunner.js";
import { validateTraversalPlan } from "./traversal.js";
import { repairUntilPlayable } from "./repairLoop.js";

const plan = (mode = "completion", seeds = [0]) => ({ version: 1, levels: [{ id: "test", mode }], seeds });
async function fixture(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "platformer-traversal-"));
  const file = path.join(dir, "game.html");
  t.after(async () => { await fs.unlink(file); await fs.rmdir(dir); });
  const opts = JSON.stringify({ gap: 60, mode: "completion", seeds: [0], ...options });
  await fs.writeFile(file, `<!DOCTYPE html><html><head><title>Traversal physics fixture</title></head><body><canvas></canvas><script>
    const options = ${opts};
    const farX = 80 + options.gap;
    const platforms = [{id:'start',x:0,y:200,w:80,h:20},{id:'far',x:farX,y:200,w:300,h:20}];
    if(options.island) platforms.push({id:'island',x:120,y:-400,w:50,h:10});
    const goal = {id:'goal',x:farX+50,y:160,w:200,h:40};
    const walls = options.wall ? [{x:80,y:-500,w:60,h:700}] : [];
    let state, previousKeys = new Set(), manual = false;
    function resetGame() { state = {tick:0,player:{x:20,y:184,w:12,h:16,vx:0,vy:0,onGround:true,alive:true},completed:[]};previousKeys.clear(); }
    function update(keys) {
      state.tick++; const p = state.player;
      if(p.alive) {
        const speed = options.dash && keys.includes('D') ? 7 : 3.5;
        p.vx = keys.includes('ArrowRight') ? speed : keys.includes('ArrowLeft') ? -speed : 0;
        if(keys.includes('Space') && !previousKeys.has('Space') && p.onGround) {p.vy=-7.5;p.onGround=false;}
        p.x += p.vx;
        for(const wall of walls) if(p.x+p.w>wall.x && p.x<wall.x+wall.w && p.y+p.h>wall.y && p.y<wall.y+wall.h) p.x=wall.x-p.w;
        const oldBottom=p.y+p.h; p.vy+=0.35;p.y+=p.vy;p.onGround=false;
        for(const surface of platforms) if(p.vy>=0 && oldBottom<=surface.y && p.y+p.h>=surface.y && p.x+p.w>surface.x && p.x<surface.x+surface.w) {p.y=surface.y-p.h;p.vy=0;p.onGround=true;}
        if(p.y>400) p.alive=false;
        if(options.mode==='completion' && p.alive && p.onGround && p.x>=goal.x) state.completed=['test'];
      }
      previousKeys=new Set(keys);
    }
    function snapshot(){return structuredClone({tick:state.tick,player:state.player,surfaces:platforms,regions:[goal],traversal:{levelId:'test',completedLevels:state.completed,recoveries:0}});}
    resetGame();
    const normalKeys = new Set();
    addEventListener('keydown',event=>normalKeys.add(event.code));
    addEventListener('keyup',event=>normalKeys.delete(event.code));
    function frame(){if(!manual) update([...normalKeys]);requestAnimationFrame(frame);} requestAnimationFrame(frame);
    const keys = options.dash ? ['ArrowRight','D'] : ['ArrowRight'];
    window.__gameTest = {snapshot,traversal:{version:1,fixedDt:1/60,
      describe:()=>({seeds:options.seeds,levels:[{id:'test',mode:options.mode,surfaces:platforms.filter(p=>!options.omitFar || p.id!=='far'),regions:[goal]}]}),
      routes:()=> options.teleport ? [{id:'cheat',seed:0,steps:[{keys:[],frames:1,x:999}]}] : [{id:'cross-gap',seed:0,steps:[{keys:['ArrowRight'],frames:8},{keys:[...keys,'Space'],frames:1},{keys,frames:45}]}],
      reset:()=>{manual=true;resetGame();if(options.fakeComplete) state.completed=['test']; return snapshot();},
      step:({keys})=>{update(keys);return snapshot();}
    }};
  </script></body></html>`);
  return file;
}

test("real collision replay completes a reachable jump and records full surface coverage", async t => {
  const result = await validateHtml(await fixture(t), { traversal: plan(), smokeMs: 0 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.traversal.simulatedFrames, 54);
  assert.deepEqual(result.traversal.coverage[0].completed, ["test"]);
  assert.deepEqual(result.traversal.coverage[0].missingTargets, []);
});

test("oversized jumps and blocked paths fail despite clean JavaScript", async t => {
  for (const options of [{ gap: 250 }, { wall: true }]) {
    const result = await validateHtml(await fixture(t, options), { traversal: plan(), smokeMs: 0 });
    assert.equal(result.ok, false);
    assert.equal(result.stage, "traversal");
    assert.match(result.errors.join(" "), /test\/far/);
    assert.match(result.errors.join(" "), /completion replay/);
    assert.match(repairFeedback(result), /lastPosition/);
  }
});

test("a real movement ability can make an otherwise impossible gap reachable", async t => {
  const result = await validateHtml(await fixture(t, { gap: 140, dash: true }), { traversal: plan(), smokeMs: 0 });
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("completing the goal does not hide an inaccessible optional platform", async t => {
  const result = await validateHtml(await fixture(t, { island: true }), { traversal: plan(), smokeMs: 0 });
  assert.equal(result.ok, false);
  assert.deepEqual(result.traversal.coverage[0].completed, ["test"]);
  assert.match(result.errors.join(" "), /test\/island/);
});

test("open-ended levels require accessibility without an invented win condition", async t => {
  const result = await validateHtml(await fixture(t, { mode: "accessibility" }), { traversal: plan("accessibility"), smokeMs: 0 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.traversal.coverage[0].completed, []);
  const island = await validateHtml(await fixture(t, { mode: "accessibility", island: true }), { traversal: plan("accessibility"), smokeMs: 0 });
  assert.equal(island.ok, false);
  assert.match(island.errors.join(" "), /island/);
});

test("omitted levels, surfaces, seeds, fabricated reset progress and teleport actions are rejected", async t => {
  for (const [options, expected, error] of [
    [{ omitFar: true }, plan(), /Unregistered/],
    [{ seeds: [0,1] }, plan("completion", [0,1]), /Seed 1/],
    [{ fakeComplete: true }, plan(), /fresh game/],
    [{ teleport: true }, plan(), /teleport/],
    [{}, { version:1,levels:[{id:'test',mode:'completion'},{id:'missing-level',mode:'completion'}],seeds:[0] }, /inventory/],
  ]) {
    const result = await validateHtml(await fixture(t, options), { traversal: expected, smokeMs: 0 });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(" "), error);
  }
});

test("missing traversal support is not silently accepted as reachability evidence", async t => {
  const file = await fixture(t);
  await fs.writeFile(file, '<!DOCTYPE html><html><head></head><body><canvas></canvas><script>let x=0;</script></body></html>');
  const result = await validateHtml(file, { traversal: true, smokeMs: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.stage, "traversal");
  assert.match(result.errors.join(" "), /Missing __gameTest.traversal/);
});

test("traversal contract rejects missing plans, invalid modes and unbounded seed lists", () => {
  assert.throws(() => validateTraversalPlan(undefined), /Traversal plan/);
  assert.throws(() => validateTraversalPlan({ ...plan(), levels:[{id:'test',mode:'skip'}] }), /mode/);
  assert.throws(() => validateTraversalPlan(plan('completion', [0,0])), /seeds/);
});

test("an unproven traversal triggers repair and only the passing revision is published", async t => {
  const broken = await fs.readFile(await fixture(t, { gap: 250 }), "utf8");
  const fixed = await fs.readFile(await fixture(t), "utf8");
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "traversal-repair-"));
  t.after(async () => {
    for (const name of await fs.readdir(outDir)) await fs.unlink(path.join(outDir, name));
    await fs.rmdir(outDir);
  });
  const result = await repairUntilPlayable({
    code: broken, rules: "Complete the gap without deleting the far platform", outDir, maxRepairs: 1,
    validationOptions: { traversal: plan(), smokeMs: 0 },
    repair: async input => {
      assert.match(input.errors, /test\/far/);
      assert.match(input.errors, /lastPosition/);
      await assert.rejects(fs.access(path.join(outDir, "game.html")));
      return fixed;
    },
  });
  assert.equal(result.repairs, 1);
  assert.equal(result.validation.traversal.ok, true);
  assert.equal(await fs.readFile(path.join(outDir, "game.html"), "utf8"), fixed);
  const rejected = JSON.parse(await fs.readFile(path.join(outDir, "attempt-0.browser.json")));
  assert.equal(rejected.stage, "traversal");
});
