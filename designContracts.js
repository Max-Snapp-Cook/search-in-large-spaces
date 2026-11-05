import { validateTraversalPlan } from "./traversal.js";
import { normalizeControls, normalizeTestInput, declaredKeys } from "./inputControls.js";

export const text = (value, label) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be nonempty text.`);
};
export function list(value, label, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum) throw new Error(`${label} must contain at least ${minimum} entries.`);
}
function unique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique.`);
}
function id(value) { text(value, "id"); if (!/^[a-zA-Z][\w-]{0,63}$/.test(value)) throw new Error("IDs must be short alphanumeric identifiers."); }
export function parseJson(response) {
  const fenced = response.trim().match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return JSON.parse(fenced ? fenced[1] : response);
}
export function validateInterview(value, brief) {
  list(value.requirements, "requirements", 1);
  const userText = [brief.idea, ...brief.answers.map(answer => answer.answer)].join("\n");
  for (const requirement of value.requirements) {
    id(requirement.id); text(requirement.text, "requirement"); text(requirement.evidence, "evidence");
    if (!userText.includes(requirement.evidence)) throw new Error(`Requirement ${requirement.id} needs an exact quote from user input.`);
  }
  unique(value.requirements.map(r => r.id), "Requirement IDs");
  for (const previous of brief.requirements || []) {
    if (!value.requirements.some(r => r.id === previous.id && r.text === previous.text)) throw new Error(`Preserve previously extracted requirement ${previous.id} verbatim.`);
  }
  list(value.assumptions, "assumptions"); value.assumptions.forEach(a => text(a, "assumption"));
  list(value.questions, "questions");
  if (value.questions.length > 6) throw new Error("Ask at most six focused questions.");
  for (const question of value.questions) {
    id(question.id); text(question.question, "question"); text(question.why, "question purpose");
    list(question.options, "question options", 2); question.options.forEach(o => text(o, "option"));
    if (brief.answers.some(answer => answer.id === question.id)) throw new Error(`Question ${question.id} was already answered.`);
  }
  unique(value.questions.map(q => q.id), "Question IDs");
  return value;
}
export function validatePlaytests(tests, requirementIds = null) {
  list(tests, "playtests", 1);
  if (tests.length > 12) throw new Error("At most 12 playtests are supported.");
  unique(tests.map(t => t.id), "Playtest IDs");
  let duration = 0;
  for (const test of tests) {
    id(test.id); text(test.purpose, "playtest purpose"); list(test.requirementIds, "playtest requirement IDs", 1);
    if (test.levelId !== undefined && (typeof test.levelId !== "string" || !/^[\w-]{1,80}$/.test(test.levelId))) throw new Error("Behavior levelId must be a concrete level identifier.");
    if (requirementIds && test.requirementIds.some(id => !requirementIds.includes(id))) throw new Error("Playtest references an unknown requirement.");
    list(test.steps, "playtest steps", 1);
    if (test.steps.length > 40 || !test.steps.some(s => s.action === "assert")) throw new Error("Each test needs assertions and at most 40 steps.");
    for (const step of test.steps) {
      normalizeTestInput(step);
      if (!["hold", "press", "down", "up", "wait", "assert"].includes(step.action)) throw new Error("Unknown playtest action.");
      if (["hold", "press", "down", "up"].includes(step.action)) {
        if (Object.hasOwn(step, "key") === Object.hasOwn(step, "keys")) throw new Error("Provide exactly one of key or keys for an input action.");
        const keys = step.keys || [step.key];
        list(keys, "input keys", 1);
        if (keys.length > 6 || new Set(keys).size !== keys.length) throw new Error("Use at most six unique simultaneous keys.");
        for (const key of keys) { text(key, "key"); if (key.length > 40) throw new Error("Key too long."); }
      }
      if (step.action === "press") duration += 50;
      if (["hold", "wait"].includes(step.action)) {
        if (!Number.isInteger(step.ms) || step.ms < 0 || step.ms > 2000) throw new Error("Timed actions must be 0..2000ms.");
        duration += step.ms;
      }
      if (step.action === "assert") {
        if (typeof step.path !== "string" || !/^[\w]+(?:\.[\w]+)*$/.test(step.path) || step.path.split(".").some(p => ["__proto__", "prototype", "constructor"].includes(p))) throw new Error("Invalid snapshot path.");
        if (!["eq", "ne", "gt", "gte", "lt", "lte", "changed"].includes(step.op)) throw new Error("Invalid assertion operator.");
        if (step.op !== "changed" && !Object.hasOwn(step, "value")) throw new Error("Comparison requires a value.");
        if (["gt", "gte", "lt", "lte"].includes(step.op) && (typeof step.value !== "number" || !Number.isFinite(step.value))) throw new Error("Numerical comparison requires a finite number.");
      }
    }
  }
  if (duration > 20_000) throw new Error("Playtests exceed the 20-second action budget.");
  return tests;
}
export function validateDesign(value, interview) {
  text(value.title, "title"); list(value.candidates, "candidates", 3);
  if (value.candidates.length !== 3) throw new Error("Provide exactly three design candidates.");
  unique(value.candidates.map(c => c.id), "Candidate IDs");
  for (const candidate of value.candidates) for (const field of ["id", "coreLoop", "mechanicalDifference", "tradeoff"]) text(candidate[field], field);
  unique(value.candidates.map(c => c.coreLoop.trim().toLowerCase()), "Candidate core loops");
  if (!value.candidates.some(c => c.id === value.selectedCandidate)) throw new Error("Selected candidate does not exist.");
  text(value.selectionReason, "selection reason");
  for (const field of ["subgenre", "movement", "combat", "world", "progression", "failure", "presentation"]) text(value.identity?.[field], `identity.${field}`);
  list(value.requirements, "requirements", 1); unique(value.requirements.map(r => r.id), "Requirement IDs");
  if (value.requirements.length !== interview.requirements.length) throw new Error("Preserve every user requirement, without adding inferred ones to this list.");
  for (const required of interview.requirements) {
    const actual = value.requirements.find(r => r.id === required.id);
    if (!actual || actual.text !== required.text) throw new Error(`Preserve requirement ${required.id} verbatim.`);
    text(actual.implementation, "implementation"); text(actual.acceptance, "acceptance");
  }
  list(value.signatureMechanics, "signature mechanics", 2);
  unique(value.signatureMechanics.map(m => m.name), "Mechanic names");
  for (const mechanic of value.signatureMechanics) for (const field of ["name", "interaction", "implementation"]) text(mechanic[field], field);
  list(value.controls, "controls", 1);
  value.controls = normalizeControls(value.controls);
  value.controls.forEach(c => text(c.action, "control action"));
  text(value.levelPlan, "level plan"); text(value.noveltyNotes, "novelty notes");
  list(value.implementationPlan, "implementation plan", 1); value.implementationPlan.forEach(s => text(s, "implementation step"));
  list(value.assumptions, "assumptions"); value.assumptions.forEach(a => text(a, "assumption"));
  list(value.playtests, "playtests", 3);
  validatePlaytests(value.playtests, value.requirements.map(r => r.id));
  for (const category of ["movement", "signature", "recovery"]) {
    if (!value.playtests.some(t => t.category === category)) throw new Error(`Include a ${category} playtest.`);
  }
  for (const test of value.playtests) {
    if (!["movement", "signature", "recovery"].includes(test.category)) throw new Error("Invalid playtest category.");
    list(test.mechanicNames, "playtest mechanic names");
    if (test.mechanicNames.some(name => !value.signatureMechanics.some(m => m.name === name))) throw new Error("Playtest references an unknown signature mechanic.");
  }
  for (const mechanic of value.signatureMechanics) {
    if (!value.playtests.some(t => t.mechanicNames.includes(mechanic.name))) throw new Error(`Playtest must exercise ${mechanic.name}.`);
  }
  const allowedKeys = declaredKeys(value.controls);
  for (const step of value.playtests.flatMap(t => t.steps)) {
    for (const key of step.keys || (step.key ? [step.key] : [])) {
      if (!allowedKeys.has(key)) throw new Error(`Test key ${key} is not in the controls. Declared keys: ${[...allowedKeys].join(", ")}. Declare each alternative separately; use keys arrays for chords.`);
    }
  }
  validateTraversalPlan(value.traversal);
  for (const test of value.playtests) {
    if (test.levelId !== undefined && !value.traversal.levels.some(level => level.id === test.levelId)) throw new Error(`Behavior test ${test.id} references unknown level ${test.levelId}.`);
  }
  return value;
}
export function validateReview(value, design) {
  for (const [field, source, key] of [["requirements", design.requirements, "id"], ["signatureMechanics", design.signatureMechanics, "name"]]) {
    list(value[field], field); unique(value[field].map(r => r[key]), field);
    if (source.length !== value[field].length) throw new Error(`Review must cover every ${field} entry.`);
    for (const entry of source) {
      const checked = value[field].find(r => r[key] === entry[key]);
      if (!checked || typeof checked.met !== "boolean") throw new Error(`Missing review coverage: ${entry[key]}`);
      text(checked.evidence, "review evidence");
    }
  }
  list(value.issues, "issues"); text(value.experienceAssessment, "experience assessment");
  for (const issue of value.issues) {
    if (!["blocking", "advisory"].includes(issue.severity)) throw new Error("Invalid issue severity.");
    text(issue.problem, "problem"); text(issue.fix, "fix"); text(issue.requirementId, "requirement ID");
  }
  return value;
}
