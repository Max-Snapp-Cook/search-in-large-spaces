import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { translatePrompt, repairPrompt } from "./prompts.js";
import { extractHtml, repairUntilPlayable } from "./repairLoop.js";
import { createGenerator } from "./codexGenerator.js";
import { loadHistory, prepareDesign, saveJson, requestJson } from "./designWorkflow.js";
import { validateTraversalPlan } from "./traversal.js";
import { traversalPlanPrompt } from "./prompts.js";
import { createQualityReviewer } from "./qualityReview.js";

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

export async function generateGame({ idea, outDir, answers, generate, ask, maxRepairs = 15, validate, historyRoot = path.dirname(outDir), log = console.log }) {
  if (!Number.isSafeInteger(maxRepairs) || maxRepairs < 0) throw new Error("MAX_REPAIRS must be a nonnegative integer.");
  await fs.mkdir(outDir, { recursive: true });
  const history = await loadHistory(historyRoot, outDir);
  let prepared = await prepareDesign({ idea, outDir, answers, generate, history });
  while (prepared.status === "awaiting_answers" && ask) {
    const response = await ask(prepared.questions, { outDir });
    if (!response) break;
    prepared = await prepareDesign({ outDir, answers: response, generate, history });
  }
  if (prepared.status === "awaiting_answers") {
    await saveJson(path.join(outDir, "result.json"), { status: "awaiting_answers", questionsFile: path.join(outDir, "questions.json") });
    log(`Game design needs your input. Questions: ${path.join(outDir, "questions.md")}`);
    log(`Fill in ${path.join(outDir, "answers.template.json")}, then run:`);
    log(`npm run gen -- --resume "${outDir}" --answers "${path.join(outDir, "answers.template.json")}"`);
    return prepared;
  }
  const { brief, design } = prepared;
  if (!design.traversal) {
    const plan = await requestJson({ generate, outDir, label: `traversal-plan-${stamp()}`, prompt: traversalPlanPrompt({ design }), validate: validateTraversalPlan });
    await fs.writeFile(path.join(outDir, `design-before-traversal-${stamp()}.json`), JSON.stringify(design, null, 2));
    design.traversal = plan;
    await saveJson(path.join(outDir, "design.json"), design);
  }
  validateTraversalPlan(design.traversal);
  const rules = JSON.stringify({ brief, design }, null, 2);
  // Resuming after failure creates a new build and never overwrites prior attempts.
  const buildDir = await fs.mkdtemp(path.join(outDir, `build-${stamp()}-`));
  await saveJson(path.join(outDir, "result.json"), { status: "generating", buildDir });
  log(`Implementing ${design.title}: ${design.identity.subgenre}. Build: ${buildDir}`);
  let summary;
  try {
    const code = extractHtml(await generate(translatePrompt({ rules })));
    summary = await repairUntilPlayable({
      code, rules, outDir: buildDir, maxRepairs, ...(validate ? { validate } : {}),
      validationOptions: { playtests: design.playtests, traversal: design.traversal, timeoutMs: 120_000 },
      repair: input => generate(repairPrompt(input)),
      assess: createQualityReviewer({ generate, brief, design, outDir: buildDir }),
    });
  } catch (error) {
    const failure = await fs.readFile(path.join(buildDir, "result.json"), "utf8").then(JSON.parse).catch(readError => {
      if (readError.code !== "ENOENT") throw readError;
      return { status: "generation_failed" };
    });
    await saveJson(path.join(outDir, "result.json"), { ...failure, buildDir, error: error.message });
    throw error;
  }
  await fs.copyFile(path.join(buildDir, "game.html"), path.join(outDir, "game.html"));
  await saveJson(path.join(outDir, "result.json"), { ...summary, buildDir, quality: "browser behavior checks and model fidelity review passed" });
  log(`Validated game saved to ${path.join(outDir, "game.html")}`);
  return { status: "validated", design, summary };
}

export async function askQuestions(questions, { outDir } = {}) {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const answers = {};
  try {
    for (const question of questions) {
      console.log(`\n${question.question}\n${question.why}`);
      question.options.forEach((option, index) => console.log(`  ${index + 1}. ${option}`));
      console.log("Enter an option number or your own answer. Type :pause to save and return later.");
      let answer = "";
      while (!answer.trim()) answer = await readline.question("> ");
      if (answer.trim() === ":pause") return null;
      const choice = /^\d+$/.test(answer.trim()) ? question.options[Number(answer.trim()) - 1] : null;
      answers[question.id] = choice || answer.trim();
      if (outDir) await saveJson(path.join(outDir, "answers.draft.json"), answers);
    }
    return answers;
  } finally { readline.close(); }
}

export async function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    resume: { type: "string" }, answers: { type: "string" }, "non-interactive": { type: "boolean", default: false },
  } });
  if (values.resume && positionals.length) throw new Error("Use either a new idea or --resume, not both.");
  if (values.answers && !values.resume) throw new Error("Use --answers with --resume for an existing interview.");
  const maxRepairs = Number(process.env.MAX_REPAIRS ?? 15);
  if (!Number.isSafeInteger(maxRepairs) || maxRepairs < 0) throw new Error("MAX_REPAIRS must be a nonnegative integer.");
  const root = path.resolve("outputs");
  await fs.mkdir(root, { recursive: true });
  let outDir;
  if (values.resume) {
    outDir = path.resolve(values.resume);
    const realRoot = await fs.realpath(root);
    const realRun = await fs.realpath(outDir);
    const relative = path.relative(realRoot, realRun);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Resume must point to a run inside outputs/.");
    await fs.access(path.join(outDir, "session.json"));
    const result = await fs.readFile(path.join(outDir, "result.json"), "utf8").then(JSON.parse).catch(error => { if (error.code !== "ENOENT") throw error; return null; });
    if (result?.status === "validated") throw new Error("This run already has a validated game. Start a new run to generate another instance.");
  } else outDir = await fs.mkdtemp(path.join(root, `${stamp()}-`));
  try {
    const answers = values.answers ? JSON.parse(await fs.readFile(values.answers, "utf8")) : undefined;
    await generateGame({
      idea: positionals.join(" ") || "a moon explorer jumping between crumbling platforms",
      outDir, answers, maxRepairs, generate: createGenerator({ onProgress: message => console.log(message) }), historyRoot: root,
      ask: !values["non-interactive"] && process.stdin.isTTY && process.stdout.isTTY ? askQuestions : undefined,
    });
  } catch (error) {
    const errorFile = path.join(outDir, `error-${stamp()}.txt`);
    await fs.writeFile(errorFile, error.stack || error.message);
    console.error(`Run artifacts: ${outDir}`);
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
