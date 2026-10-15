// pipeline.js
// Main entry point: takes a game idea and generates a working Ludii game.

// pipeline.js

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";

const model = new ChatOpenAI({
  model: "openrouter:z-ai/glm-5.3-flash",
  apiKey: process.env.BAYLEAF_API_KEY,
  configuration: { baseURL: "https://api.bayleaf.dev/v1" },
});

// Load the example .lud files
async function loadExamples(dir = "examples") {
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".lud"));
  const examples = await Promise.all(
    files.map(async (f) => `--- ${f} ---\n${await fs.readFile(path.join(dir, f), "utf8")}`)
  );
  return examples.join("\n\n");
}

// Generate the rules from the game idea
const rulesPrompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a board game designer. Your games must be implementable in the Ludii game system."],
  ["human",
`Reference Ludii games:
{examples}

Using these games as reference, design a new game based on this idea: {idea}

Write complete plain-English rules: board, pieces, setup, turns, legal moves, captures, and how the game ends.
Only use mechanics similar to the reference games. Start with the game's name. No code.`],
]);

// Translate the rules into .lud code
const translatePrompt = ChatPromptTemplate.fromMessages([
  ["system", "You translate game rules into Ludii .lud code, using only ludemes that appear in the reference games."],
  ["human",
`Reference Ludii games:
{examples}

Rules:
{rules}

Output ONLY the .lud code inside a single \`\`\`lud code block.`],
]);

const rulesChain = rulesPrompt.pipe(model).pipe(new StringOutputParser());
const translateChain = translatePrompt.pipe(model).pipe(new StringOutputParser());

function extractLud(text) {
  const match = text.match(/```(?:lud)?\s*([\s\S]*?)```/);
  return (match ? match[1] : text).trim();
}

async function run(idea) {
  const examples = await loadExamples();

  const rules = await rulesChain.invoke({ examples, idea });
  console.log("RULES:\n", rules);

  const code = extractLud(await translateChain.invoke({ examples, rules }));
  console.log("\nLUD:\n", code);

  // Save so you can open game.lud in Ludii and check it
  const outDir = path.join("outputs", new Date().toISOString().replace(/[:.]/g, "-"));
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "rules.md"), rules);
  await fs.writeFile(path.join(outDir, "game.lud"), code);
  console.log(`\nSaved to ${outDir}`);
}

const idea = process.argv[2] ?? "a two-player capture game on a hexagonal board";
run(idea).catch(console.error);
// Load the example .lud files

// Generate the rules from the game idea

// Translate the rules into .lud code

