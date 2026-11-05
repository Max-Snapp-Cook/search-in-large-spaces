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

// Both providers speak the OpenAI chat API, so the same LangChain chains work with either.
// PROVIDER picks one; by default BayLeaf is used whenever its key is set.
const providers = {
  bayleaf: {
    keyName: "BAYLEAF_API_KEY",
    model: process.env.MODEL || "openrouter:moonshotai/kimi-k3.1-pro",
    baseURL: process.env.BASE_URL || "https://api.bayleaf.dev/v1",
  },
  gemini: {
    keyName: "GEMINI_API_KEY",
    model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  },
};
const providerName = (process.env.PROVIDER || (process.env.BAYLEAF_API_KEY?.trim() ? "bayleaf" : "gemini")).toLowerCase();
const provider = providers[providerName];
if (!provider) {
  throw new Error(`PROVIDER must be one of: ${Object.keys(providers).join(", ")}.`);
}
if (!process.env[provider.keyName]?.trim()) {
  throw new Error(`Set ${provider.keyName} in .env before running the pipeline with PROVIDER=${providerName}.`);
}

// Each model call (rules, code, or one repair) must finish streaming within this many seconds.
const timeoutSeconds = Number(process.env.LLM_TIMEOUT ?? 600);
if (!(timeoutSeconds > 0)) {
  throw new Error("LLM_TIMEOUT must be a positive number of seconds.");
}

// Replies are streamed. The SDK timeout only covers the wait for the response to start, so the
// full deadline is enforced in ask() with an abort signal. The SDK timeout is set slightly longer
// so that signal always fires first: an abort is not retried, because resending a request that
// ran out of time would just run out again. Connection errors, 429s and 5xx are still retried twice.
const model = new ChatOpenAI({
  model: provider.model,
  apiKey: process.env[provider.keyName],
  streaming: true,
  timeout: timeoutSeconds * 1000 + 5000,
  maxRetries: 2,
  configuration: { baseURL: provider.baseURL },
});
const modelLabel = `${providerName} ${provider.model}`;

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

// Streams a model reply, showing elapsed time and characters received, and aborts it once it
// has run for timeoutSeconds. Reasoning models may think for a while before the first character.
async function ask(task, chain, input) {
  console.log(`\nWaiting for ${modelLabel} to ${task} (limit ${timeoutSeconds}s)...`);
  const start = Date.now();
  const elapsed = () => Math.round((Date.now() - start) / 1000);
  let reply = "";
  const status = () => `  ${elapsed()}s, ${reply.length} characters received`;
  // On a terminal the status line updates in place; in a log it is printed every 30s.
  const tty = process.stdout.isTTY;
  const ticker = setInterval(
    () => (tty ? process.stdout.write(`\r${status()}`) : console.log(status())),
    tty ? 1000 : 30000,
  );
  const signal = AbortSignal.timeout(timeoutSeconds * 1000);
  try {
    const stream = await chain.stream(input, { signal });
    for await (const chunk of stream) reply += chunk;
  } catch (error) {
    if (signal.aborted) {
      throw new Error(
        `${modelLabel} did not finish (${task}) within ${timeoutSeconds}s; ${reply.length} characters had arrived. ` +
        "Raise LLM_TIMEOUT or try again.",
        { cause: error },
      );
    }
    throw error;
  } finally {
    clearInterval(ticker);
    if (tty) process.stdout.write("\n");
  }
  console.log(`Finished in ${elapsed()}s (${reply.length} characters).`);
  return reply;
}

async function run(idea) {
  const maxRepairs = Number(process.env.MAX_REPAIRS ?? 5);
  if (!Number.isSafeInteger(maxRepairs) || maxRepairs < 0) {
    throw new Error("MAX_REPAIRS must be a nonnegative integer.");
  }
  const examples = await loadExamples();
  const contract = await fs.readFile(path.join(projectDir, "contract.md"), "utf8");

  // RULES=path/to/rules.md reuses rules from an earlier run instead of writing new ones.
  const rules = process.env.RULES
    ? await fs.readFile(path.resolve(process.env.RULES), "utf8")
    : await ask("write the rules", rulesChain, { examples, idea });
  console.log("RULES:\n", rules);

  // A unique directory keeps every attempt and its validation feedback together. It is created
  // before the code is written so the rules survive if a later step fails.
  const outputs = path.join(projectDir, "outputs");
  await fs.mkdir(outputs, { recursive: true });
  const outDir = await fs.mkdtemp(path.join(outputs, `${new Date().toISOString().replace(/[:.]/g, "-")}-`));
  const rulesFile = path.join(outDir, "rules.md");
  await fs.writeFile(rulesFile, rules);
  console.log(`Rules saved to ${rulesFile} (rerun with RULES=${path.relative(process.cwd(), rulesFile)} to reuse them).`);

  const code = extractCode(await ask("write game.js", translateChain, { examples, rules, contract }));
  console.log(`\nGenerated ${code.length} characters of JavaScript.`);

  const { validation } = await repairUntilPlayable({
    code, rules, examples, outDir, maxRepairs,
    repair: (input) => ask("repair game.js", repairChain, { ...input, contract }),
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
