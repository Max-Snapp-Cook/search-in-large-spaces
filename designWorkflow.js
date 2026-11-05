import fs from "node:fs/promises";
import path from "node:path";
import { interviewPrompt, designPrompt } from "./prompts.js";
import { parseJson, validateInterview, validateDesign, text } from "./designContracts.js";

export const saveJson = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2));
export async function requestJson({ generate, prompt, validate, outDir, label }) {
  let feedback = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await generate(prompt + feedback);
    await fs.writeFile(path.join(outDir, `${label}.response-${attempt}.txt`), raw);
    try {
      const result = validate(parseJson(raw));
      await saveJson(path.join(outDir, `${label}.json`), result);
      return result;
    } catch (error) {
      await fs.writeFile(path.join(outDir, `${label}.error-${attempt}.txt`), error.message);
      if (attempt === 2) throw new Error(`${label}: invalid structured response: ${error.message}`);
      feedback = `\nYour previous response failed validation: ${error.message}. Return the entire JSON object again, adhering to the requested contract. Do not drop requirements to fix formatting.`;
    }
  }
}

export async function loadHistory(root, exclude) {
  const dirs = (await fs.readdir(root, { withFileTypes: true })).filter(d => d.isDirectory() && path.resolve(root, d.name) !== path.resolve(exclude)).sort((a, b) => b.name.localeCompare(a.name));
  const history = [];
  for (const dir of dirs) {
    try {
      const design = JSON.parse(await fs.readFile(path.join(root, dir.name, "design.json"), "utf8"));
      if (design.identity && Array.isArray(design.signatureMechanics)) history.push({ title: design.title, identity: design.identity, signatureMechanics: design.signatureMechanics, status: "previous design; not necessarily a validated game" });
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    if (history.length === 8) break;
  }
  return history;
}

export async function prepareDesign({ outDir, idea, answers, generate, history = [] }) {
  await fs.mkdir(outDir, { recursive: true });
  const stateFile = path.join(outDir, "session.json");
  let state;
  try { state = JSON.parse(await fs.readFile(stateFile, "utf8")); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    text(idea, "game idea");
    state = { version: 1, idea, answers: [], round: 0, status: "interview" };
    await fs.writeFile(path.join(outDir, "idea.txt"), idea);
    await saveJson(stateFile, state);
  }
  if (state.version !== 1 || !Array.isArray(state.answers)) throw new Error("Unsupported design session.");
  if (state.status === "design_ready") {
    if (answers !== undefined) throw new Error("Design is already locked. Start a new run to change the brief.");
    return { status: "design_ready", brief: { idea: state.idea, answers: state.answers }, design: JSON.parse(await fs.readFile(path.join(outDir, "design.json"), "utf8")) };
  }
  if (answers !== undefined) {
    if (state.status !== "awaiting_answers") throw new Error("There are no pending questions to answer.");
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) throw new Error("Answers must be a JSON object mapping question IDs to nonempty answers.");
    if (Object.keys(answers).some(id => !state.questions.some(q => q.id === id))) throw new Error("Answers contain an unknown question ID.");
    for (const question of state.questions) text(answers[question.id], `Answer for ${question.id}`);
    for (const question of state.questions) state.answers.push({ id: question.id, question: question.question, answer: answers[question.id].trim() });
    state.questions = []; state.status = "interview";
    await saveJson(stateFile, state);
  }
  const brief = { idea: state.idea, answers: state.answers, requirements: state.requirements || [] };
  if (state.status === "awaiting_answers") return { status: "awaiting_answers", questions: state.questions, brief };
  let interview;
  // Also recover runs written before the explicit designing phase existed.
  // A completed latest interview with unchanged requirements is safe to reuse:
  // new answers can only be accepted after an interview with pending questions.
  if (state.round > 0) {
    try {
      const cached = JSON.parse(await fs.readFile(path.join(outDir, `interview-${state.round - 1}.json`), "utf8"));
      if (cached.questions?.length === 0 && JSON.stringify(cached.requirements) === JSON.stringify(state.requirements)) {
        interview = validateInterview(cached, brief);
      }
    } catch (error) {
      if (state.status === "designing" || error.code !== "ENOENT") throw error;
    }
  }
  if (!interview) {
    interview = await requestJson({ generate, prompt: interviewPrompt({ brief }), validate: value => validateInterview(value, brief), outDir, label: `interview-${state.round}` });
    state.requirements = interview.requirements;
    state.round++;
  }
  if (interview.questions.length) {
    state.status = "awaiting_answers"; state.questions = interview.questions;
    await saveJson(path.join(outDir, "questions.json"), { round: state.round, questions: state.questions });
    await saveJson(path.join(outDir, "answers.template.json"), Object.fromEntries(state.questions.map(q => [q.id, ""])));
    await fs.writeFile(path.join(outDir, "questions.md"), state.questions.map(q => `## ${q.id}: ${q.question}\n\n${q.why}\n\n${q.options.map(o => `- ${o}`).join("\n")}\n\nFree-text answers are welcome; explicitly delegate choices if desired.`).join("\n\n"));
    await saveJson(stateFile, state);
    return { status: state.status, questions: state.questions, brief };
  }
  state.status = "designing";
  await saveJson(stateFile, state);
  await saveJson(path.join(outDir, "result.json"), { status: "designing", round: state.round });
  await saveJson(path.join(outDir, "questions.json"), { round: state.round, questions: [] });
  const design = await requestJson({ generate, prompt: designPrompt({ brief, interview, history }), validate: value => validateDesign(value, interview), outDir, label: `design-${state.round}` });
  await saveJson(path.join(outDir, "design.json"), design);
  await saveJson(path.join(outDir, "history.json"), history);
  await fs.writeFile(path.join(outDir, "rules.md"), `# ${design.title}\n\n${design.selectionReason}\n\n${design.requirements.map(r => `- ${r.id}: ${r.text}\n  Implementation: ${r.implementation}\n  Acceptance: ${r.acceptance}`).join("\n")}\n\n## Game identity\n\n${JSON.stringify(design.identity, null, 2)}\n\n## Level plan\n\n${design.levelPlan}`);
  state.status = "design_ready"; state.questions = [];
  await saveJson(path.join(outDir, "questions.json"), { round: state.round, questions: [] });
  await saveJson(stateFile, state);
  return { status: "design_ready", design, brief };
}
