import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareDesign, loadHistory, requestJson } from "./designWorkflow.js";
import { validateDesign, validateInterview, validateReview, validatePlaytests } from "./designContracts.js";
import { generateGame } from "./pipeline.js";
import { createQualityReviewer } from "./qualityReview.js";
import { assertSnapshot } from "./playtests.js";

const idea = "a momentum platformer with no combat";
const requirement = { id: "R1", text: "No combat", evidence: "no combat" };
const interview = () => ({ requirements: [requirement], assumptions: [], questions: [] });
const questions = () => ({ ...interview(), questions: [{ id: "failure", question: "How should failure work?", why: "Changes checkpoints and recovery.", options: ["Instant room retry", "Limited lives"] }] });
const design = () => ({
  title: "Momentum Lab", candidates: ["A", "B", "C"].map(id => ({ id, coreLoop: `Loop ${id}`, mechanicalDifference: `Difference ${id}`, tradeoff: `Tradeoff ${id}` })),
  selectedCandidate: "A", selectionReason: "Requested momentum and no combat.",
  identity: { subgenre: "momentum traversal", movement: "inertia", combat: "none", world: "rooms", progression: "room unlocks", failure: "instant retry", presentation: "speed trails" },
  requirements: [{ id: "R1", text: "No combat", implementation: "No damage or attack system", acceptance: "Traversal inputs only" }],
  signatureMechanics: [{ name: "momentum", interaction: "speed affects spring height", implementation: "acceleration and springs" }, { name: "springs", interaction: "preserve horizontal speed", implementation: "contact launch" }],
  controls: [{ key: "ArrowRight", action: "accelerate" }, { key: "r", action: "restart" }],
  levelPlan: "A room with a reachable spring and exit", implementationPlan: ["Integrate inertia and spring collisions"], assumptions: [], noveltyNotes: "Momentum rooms rather than a collectible course",
  traversal: { version: 1, levels: [{ id: "lab", mode: "completion" }], seeds: [0] },
  playtests: ["movement", "signature", "recovery"].map(category => ({ id: category, category, mechanicNames: category === "signature" ? ["momentum", "springs"] : [], requirementIds: ["R1"], purpose: category, steps: [{ action: "hold", key: "ArrowRight", ms: 100 }, { action: "assert", path: "player.x", op: "changed" }] })),
});
const review = (met = true) => ({ requirements: [{ id: "R1", met, evidence: met ? "No attack handlers" : "An attack handler exists" }], signatureMechanics: design().signatureMechanics.map(m => ({ name: m.name, met: true, evidence: "Real velocity transitions" })), issues: [], experienceAssessment: "Momentum traversal code checked" });
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "platformer-design-"));
  // The resolved fixture is explicitly within the operating system temporary directory.
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const outDir = path.join(root, "run");
  await fs.mkdir(outDir);
  return { root, outDir };
}

test("ambiguous ideas pause before coding and preserve targeted questions for resumption", async t => {
  const { outDir } = await fixture(t);
  let calls = 0;
  const first = await prepareDesign({ idea, outDir, generate: async () => { calls++; return JSON.stringify(questions()); } });
  assert.equal(first.status, "awaiting_answers");
  assert.equal(calls, 1);
  assert.equal(JSON.parse(await fs.readFile(path.join(outDir, "answers.template.json"))).failure, "");
  const pending = await prepareDesign({ outDir, generate: () => assert.fail("Must wait for answers") });
  assert.equal(pending.questions[0].id, "failure");
  await assert.rejects(prepareDesign({ outDir, answers: {}, generate: () => assert.fail() }), /Answer for failure/);
  await assert.rejects(prepareDesign({ outDir, answers: { unknown: "oops" }, generate: () => assert.fail() }), /unknown question/);
  const responses = [interview(), design()];
  const completed = await prepareDesign({ outDir, answers: { failure: "Instant room retry" }, generate: async prompt => {
    assert.match(prompt, /Instant room retry/);
    return JSON.stringify(responses.shift());
  } });
  assert.equal(completed.status, "design_ready");
  assert.equal(completed.brief.answers[0].answer, "Instant room retry");
  assert.equal(JSON.parse(await fs.readFile(path.join(outDir, "questions.json"))).questions.length, 0);
  const ready = await prepareDesign({ outDir, generate: () => assert.fail("Do not redesign locked runs") });
  assert.equal(ready.design.title, "Momentum Lab");
});

test("user requirements are grounded, survive answers, and cannot disappear in design/review", () => {
  const brief = { idea, answers: [], requirements: [requirement] };
  assert.throws(() => validateInterview({ ...interview(), requirements: [{ ...requirement, evidence: "swords" }] }, brief), /exact quote/);
  assert.throws(() => validateInterview({ ...interview(), requirements: [{ ...requirement, id: "R2" }] }, brief), /Preserve/);
  assert.throws(() => validateInterview(questions(), { idea, answers: [{ id: "failure", answer: "retry" }] }), /already answered/);
  const altered = design(); altered.requirements[0].text = "Add combat";
  assert.throws(() => validateDesign(altered, interview()), /verbatim/);
  assert.throws(() => validateReview({ ...review(), requirements: [] }, design()), /cover every/);
  assert.throws(() => validateReview({ ...review(), signatureMechanics: [] }, design()), /cover every/);
});

test("structured failures are retried and archived instead of silently defaulting", async t => {
  const { outDir } = await fixture(t);
  let attempts = 0;
  const result = await requestJson({ outDir, label: "contract", prompt: "json", validate: v => validateInterview(v, { idea, answers: [] }), generate: async prompt => {
    attempts++;
    if (attempts === 1) return "not json";
    assert.match(prompt, /failed validation/);
    return JSON.stringify(interview());
  } });
  assert.equal(result.requirements[0].id, "R1");
  assert.equal(await fs.readFile(path.join(outDir, "contract.response-0.txt"), "utf8"), "not json");
  await assert.rejects(requestJson({ outDir, label: "bad", prompt: "json", validate: v => validateDesign(v, interview()), generate: async () => "{}" }), /invalid structured response/);
});

test("history includes recent mechanical identities and tolerates older runs", async t => {
  const { root, outDir } = await fixture(t);
  await fs.mkdir(path.join(root, "old-html-only"));
  await fs.mkdir(path.join(root, "previous-design"));
  await fs.writeFile(path.join(root, "previous-design", "design.json"), JSON.stringify(design()));
  const history = await loadHistory(root, outDir);
  assert.equal(history.length, 1);
  assert.equal(history[0].identity.combat, "none");
});

test("the full pipeline repairs a runtime-clean game rejected for user-intent drift", async t => {
  const { outDir } = await fixture(t);
  let generation = 0;
  const responses = [interview(), design(), "<html>wrong game</html>", review(false), "<html>corrected game</html>", review(true)];
  const result = await generateGame({ idea, outDir, log: () => {}, generate: async prompt => {
    generation++;
    if (generation === 3) { assert.match(prompt, /No combat/); assert.match(prompt, /momentum/); }
    if (generation === 5) { assert.match(prompt, /R1 missing/); assert.match(prompt, /No combat/); }
    const response = responses.shift();
    return typeof response === "string" ? response : JSON.stringify(response);
  }, validate: async (_file, options) => {
    assert.equal(options.playtests.length, 3);
    return { ok: true, stage: "complete", errors: [], playtests: [{ ok: true }] };
  } });
  assert.equal(result.status, "validated");
  assert.equal(result.summary.repairs, 1);
  assert.equal(await fs.readFile(path.join(outDir, "game.html"), "utf8"), "<html>corrected game</html>");
  const report = JSON.parse(await fs.readFile(path.join(result.summary.lastAttempt, "..", "attempt-0.json")));
  assert.equal(report.stage, "quality");
  assert.equal(report.browser.ok, true);
});

test("quality rejection at repair limit never publishes game.html", async t => {
  const { outDir } = await fixture(t);
  const responses = [interview(), design(), "<html>wrong</html>", review(false)];
  await assert.rejects(generateGame({ idea, outDir, maxRepairs: 0, log: () => {}, generate: async () => {
    const response = responses.shift(); return typeof response === "string" ? response : JSON.stringify(response);
  }, validate: async () => ({ ok: true, stage: "complete", errors: [] }) }), /repair_limit_reached/);
  await assert.rejects(fs.access(path.join(outDir, "game.html")));
});

test("playtest contracts reject executable code, unsafe paths and unbounded action time", () => {
  const tests = design().playtests;
  tests[0].steps.push({ action: "evaluate", code: "process.exit()" });
  assert.throws(() => validatePlaytests(tests), /Unknown/);
  assert.throws(() => validatePlaytests([{ ...design().playtests[0], steps: [{ action: "assert", path: "__proto__.x", op: "changed" }] }]), /Invalid snapshot/);
  assert.throws(() => validatePlaytests([{ ...design().playtests[0], steps: [{ action: "wait", ms: 999999 }, { action: "assert", path: "player.x", op: "changed" }] }]), /0..2000/);
  assert.throws(() => assertSnapshot({ player: { x: 1 } }, { player: { x: 1 } }, { path: "player.x", op: "changed" }), /observed/);
  assert.throws(() => assertSnapshot({}, {}, { path: "missing", op: "eq", value: 0 }), /missing/);
});

test("a questions-only pipeline run publishes questions but never implementation artifacts", async t => {
  const { outDir } = await fixture(t);
  let calls = 0;
  const result = await generateGame({ idea, outDir, log: () => {}, generate: async () => { calls++; return JSON.stringify(questions()); }, validate: () => assert.fail("Do not validate before answers") });
  assert.equal(calls, 1);
  assert.equal(result.status, "awaiting_answers");
  assert.equal(JSON.parse(await fs.readFile(path.join(outDir, "result.json"))).status, "awaiting_answers");
  await assert.rejects(fs.access(path.join(outDir, "game.html")));
  assert.equal((await fs.readdir(outDir)).filter(name => name.startsWith("build-")).length, 0);
});

test("design acceptance requires mechanic coverage and different candidate loops", () => {
  const missingCoverage = design();
  missingCoverage.playtests[1].mechanicNames = ["momentum"];
  assert.throws(() => validateDesign(missingCoverage, interview()), /exercise springs/);
  const missingRecovery = design();
  missingRecovery.playtests[2].category = "movement";
  assert.throws(() => validateDesign(missingRecovery, interview()), /recovery playtest/);
  const duplicates = design();
  duplicates.candidates[1].coreLoop = duplicates.candidates[0].coreLoop;
  assert.throws(() => validateDesign(duplicates, interview()), /core loops must be unique/);
});

test("resuming a failed implementation keeps the locked design and all prior builds", async t => {
  const { outDir } = await fixture(t);
  const first = [interview(), design(), "<html>bad first build</html>", review(false)];
  await assert.rejects(generateGame({ idea, outDir, maxRepairs: 0, log: () => {}, generate: async () => {
    const result = first.shift(); return typeof result === "string" ? result : JSON.stringify(result);
  }, validate: async () => ({ ok: true, stage: "complete", errors: [] }) }), /repair_limit_reached/);
  const failed = JSON.parse(await fs.readFile(path.join(outDir, "result.json")));
  assert.equal(failed.status, "repair_limit_reached");
  const second = ["<html>good second build</html>", review(true)];
  await generateGame({ outDir, log: () => {}, generate: async () => {
    assert.ok(second.length, "Must not rerun interview or design");
    const result = second.shift(); return typeof result === "string" ? result : JSON.stringify(result);
  }, validate: async () => ({ ok: true, stage: "complete", errors: [] }) });
  assert.equal((await fs.readdir(outDir)).filter(name => name.startsWith("build-")).length, 2);
  assert.equal(await fs.readFile(path.join(failed.buildDir, "attempt-0.html"), "utf8"), "<html>bad first build</html>");
  assert.equal(await fs.readFile(path.join(outDir, "game.html"), "utf8"), "<html>good second build</html>");
});

test("simultaneous input contracts reject ambiguous keys and validate every control", () => {
  const base=design().playtests[0];
  assert.throws(()=>validatePlaytests([{...base,steps:[{action:'hold',key:'x',keys:['x'],ms:10},{action:'assert',path:'player.x',op:'eq',value:0}]}]),/exactly one/);
  assert.throws(()=>validatePlaytests([{...base,steps:[{action:'hold',keys:['x','x'],ms:10},{action:'assert',path:'player.x',op:'eq',value:0}]}]),/unique/);
  const contract=design();
  contract.playtests[0].steps[0]={action:'hold',keys:['ArrowRight','Unknown'],ms:100};
  assert.throws(()=>validateDesign(contract,interview()),/Unknown.*controls/);
  assert.doesNotThrow(()=>assertSnapshot({}, {data:{b:2,a:1}}, {path:'data',op:'eq',value:{a:1,b:2}}));
});

test("explicit control alternatives and modifier chords are normalized without inventing bindings", () => {
  const contract=design();
  contract.controls=[{key:'ArrowRight / KeyD',action:'move right'},{key:'ShiftLeft + KeyR',action:'restart'}];
  contract.playtests[0].steps=[{action:'hold',key:'KeyD',ms:100},{action:'assert',path:'player.x',op:'changed'}];
  contract.playtests[2].steps=[{action:'press',key:'ShiftLeft+KeyR'},{action:'assert',path:'player.x',op:'eq',value:0}];
  const checked=validateDesign(contract,interview());
  assert.deepEqual(checked.controls,[{key:'ArrowRight',action:'move right'},{key:'KeyD',action:'move right'},{keys:['ShiftLeft','KeyR'],action:'restart'}]);
  assert.deepEqual(checked.playtests[2].steps[0],{action:'press',keys:['ShiftLeft','KeyR']});
  assert.deepEqual(validateDesign(checked,interview()),checked,'normalization must be idempotent');
  const unknown=design(); unknown.controls=[{key:'ArrowLeft / KeyA',action:'move left'}];
  assert.throws(()=>validateDesign(unknown,interview()),/ArrowRight is not in the controls/);
  const ambiguous=design(); ambiguous.playtests[0].steps[0].key='ArrowRight / KeyD';
  assert.throws(()=>validateDesign(ambiguous,interview()),/one concrete binding/);
});

test("a timed-out design resumes from its completed interview, including legacy sessions", async t => {
  for(const legacy of [false,true]) {
    const {outDir}=await fixture(t);
    let firstCalls=0;
    await assert.rejects(prepareDesign({idea,outDir,generate:async()=> {
      if(++firstCalls===1) return JSON.stringify(interview());
      throw new Error('Local generation timeout');
    }}),/Local generation timeout/);
    const state=JSON.parse(await fs.readFile(path.join(outDir,'session.json'),'utf8'));
    assert.equal(state.status,'designing');
    assert.equal(state.round,1);
    assert.equal(JSON.parse(await fs.readFile(path.join(outDir,'result.json'),'utf8')).status,'designing');
    if(legacy) {state.status='interview';await fs.writeFile(path.join(outDir,'session.json'),JSON.stringify(state));}
    let resumedCalls=0;
    const result=await prepareDesign({outDir,generate:async prompt=> {
      resumedCalls++;
      assert.match(prompt,/senior game designer/);
      return JSON.stringify(design());
    }});
    assert.equal(resumedCalls,1,'must not repeat the interview');
    assert.equal(result.status,'design_ready');
  }
});

test("behavior tests cannot silently target a nonexistent level", () => {
  const contract=design();
  contract.playtests[0].levelId='unknown-lab';
  assert.throws(()=>validateDesign(contract,interview()),/unknown level unknown-lab/);
  assert.throws(()=>validatePlaytests([{...design().playtests[0],levelId:'../elsewhere'}]),/concrete level identifier/);
});
