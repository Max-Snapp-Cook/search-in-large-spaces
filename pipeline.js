// pipeline.js
// Main entry point: takes a game idea and generates a working Ludii game.

// pipeline.js

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { ChatOpenAI } from "@langchain/openai";
import { rulesPrompt, translatePrompt, repairPrompt } from "./prompts.js";
import { extractLud, repairUntilPlayable } from "./repairLoop.js";
import { StringOutputParser } from "@langchain/core/output_parsers";

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

// Load the example .lud files
async function loadExamples(dir = "examples") {
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".lud"));
  const examples = await Promise.all(
    files.map(async (f) => `--- ${f} ---\n${await fs.readFile(path.join(dir, f), "utf8")}`)
  );
  return examples.join("\n\n");
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

  const rules = await rulesChain.invoke({ examples, idea });
  console.log("RULES:\n", rules);

  const code = extractLud(await translateChain.invoke({ examples, rules }));
  console.log("\nLUD:\n", code);

  // A unique directory keeps every attempt and its validation feedback together.
  await fs.mkdir("outputs", { recursive: true });
  const outDir = await fs.mkdtemp(path.join("outputs", `${new Date().toISOString().replace(/[:.]/g, "-")}-`));
  await fs.writeFile(path.join(outDir, "rules.md"), rules);
  await repairUntilPlayable({
    code, rules, examples, outDir, maxRepairs,
    repair: (input) => repairChain.invoke(input),
  });
  console.log(`\nValidated game saved to ${path.join(outDir, "game.lud")}`);
}

const idea = process.argv[2] ?? "a two-player capture game on a hexagonal board";
run(idea).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
// Load the example .lud files

// Generate the rules from the game idea

// Translate the rules into .lud code

