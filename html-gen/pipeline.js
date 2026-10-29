// pipeline.js
// Main entry point: takes a game idea and generates a playable website (index.html + game.js).

import dotenv from "dotenv";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChatOpenAI } from "@langchain/openai";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { rulesPrompt, translatePrompt, repairPrompt } from "./prompts.js";
import { extractCode, repairUntilPlayable } from "./repairLoop.js";

// Settings in html-gen/.env win; the repo-root .env is the fallback.
const projectDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: [path.join(projectDir, ".env"), path.join(projectDir, "..", ".env")], quiet: true });

if (!process.env.GEMINI_API_KEY?.trim()) {
  throw new Error("Set GEMINI_API_KEY in .env before running the pipeline.");
}

// Gemini's OpenAI-compatible endpoint works with the existing LangChain chains.
const model = new ChatOpenAI({
  model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
  apiKey: process.env.GEMINI_API_KEY,
  configuration: {
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  },
});

// Load the example game.js files (the folder may be empty)
async function loadExamples(dir = path.join(projectDir, "examples")) {
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".js"));
  const examples = await Promise.all(
    files.map(async (f) => `--- ${f} ---\n${await fs.readFile(path.join(dir, f), "utf8")}`)
  );
  return examples.join("\n\n") || "(none yet)";
}

// Opens the finished game in the default browser (set OPEN_GAME=false to skip).
function openInBrowser(file) {
  if (/^(0|false|no)$/i.test(process.env.OPEN_GAME ?? "")) return;
  const [command, args] = process.platform === "darwin" ? ["open", [file]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", file]]
    : ["xdg-open", [file]];
  spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true })
    .on("error", () => console.log(`Open ${file} in a browser to play.`))
    .unref();
}

const rulesChain = rulesPrompt.pipe(model).pipe(new StringOutputParser());
const translateChain = translatePrompt.pipe(model).pipe(new StringOutputParser());
const repairChain = repairPrompt.pipe(model).pipe(new StringOutputParser());

async function run(idea) {
  const maxRepairs = Number(process.env.MAX_REPAIRS ?? 5);
  if (!Number.isSafeInteger(maxRepairs) || maxRepairs < 0) {
    throw new Error("MAX_REPAIRS must be a nonnegative integer.");
  }
  const examples = await loadExamples();
  const contract = await fs.readFile(path.join(projectDir, "contract.md"), "utf8");

  const rules = await rulesChain.invoke({ examples, idea });
  console.log("RULES:\n", rules);

  const code = extractCode(await translateChain.invoke({ examples, rules, contract }));
  console.log(`\nGenerated ${code.length} characters of JavaScript.`);

  // A unique directory keeps every attempt and its validation feedback together.
  const outputs = path.join(projectDir, "outputs");
  await fs.mkdir(outputs, { recursive: true });
  const outDir = await fs.mkdtemp(path.join(outputs, `${new Date().toISOString().replace(/[:.]/g, "-")}-`));
  await fs.writeFile(path.join(outDir, "rules.md"), rules);
  const { validation } = await repairUntilPlayable({
    code, rules, examples, outDir, maxRepairs,
    repair: (input) => repairChain.invoke({ ...input, contract }),
  });
  if (validation.stats) console.log("\nRandom playout stats:", validation.stats);
  const site = path.join(outDir, "index.html");
  console.log(`\nValidated game saved to ${outDir} (open index.html to play)`);
  openInBrowser(site);
}

const idea = process.argv[2] ?? "a two-player capture game on a hexagonal board";
run(idea).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
