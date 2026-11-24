// pipeline.js
// Main entry point: takes a game idea and generates a playable website (index.html + game.js).

import dotenv from "dotenv";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChatOpenAI } from "@langchain/openai";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { clarifyPrompt, rulesPrompt, translatePrompt, repairPrompt } from "./prompts.js";
import { parseQuestions, askQuestions, formatPreferences } from "./clarify.js";
import { extractCode, repairUntilPlayable } from "./repairLoop.js";
import { splitDesignNotes } from "./designNotes.js";
import { continuationMessages, joinContinuation, minContinueChars } from "./continuation.js";
import {
  resolveStyle, styleMessages, formatStyle, noStyle, styleCachePath, imageDigest, readCachedGuide, writeCachedGuide,
} from "./style.js";

// Settings in html-gen/.env win; the repo-root .env is the fallback. Other settings set in the shell
// (e.g. `MODEL=x npm run gen`) win over .env, but API keys always come from .env when it has them,
// so switching keys only takes editing .env, even in a terminal that still holds an old exported key.
const projectDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFiles = [path.join(projectDir, ".env"), path.join(projectDir, "..", ".env")];
const fromShell = new Set(Object.keys(process.env));
dotenv.config({ path: envFiles, quiet: true });
const apiKeyNames = ["BAYLEAF_API_KEY", "GEMINI_API_KEY"];
for (const file of [...envFiles].reverse()) {
  const parsed = await fs.readFile(file, "utf8").then(dotenv.parse, () => ({}));
  for (const name of apiKeyNames) {
    if (parsed[name]?.trim()) {
      process.env[name] = parsed[name];
      fromShell.delete(name);
    }
  }
}

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
const timeoutSeconds = Number(process.env.LLM_TIMEOUT ?? 1000);
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
// Shows which key is in use (last 4 characters only) and where it came from, so a stale key
// exported in the shell is easy to spot.
const keySource = fromShell.has(provider.keyName)
  ? "your shell environment (.env does not set it)"
  : ".env";
console.log(`Using ${modelLabel} with ${provider.keyName} ending in ...${process.env[provider.keyName].trim().slice(-4)} from ${keySource}.`);

// The art-style step sends images, so it may need a vision model: STYLE_MODEL overrides the model
// for that one call (same provider and key).
const styleModel = process.env.STYLE_MODEL
  ? new ChatOpenAI({
    model: process.env.STYLE_MODEL,
    apiKey: process.env[provider.keyName],
    streaming: true,
    timeout: timeoutSeconds * 1000 + 5000,
    maxRetries: 2,
    configuration: { baseURL: provider.baseURL },
  })
  : model;

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

// A chain is a prompt template (or none, when the caller passes ready-made messages) plus the model
// that answers it. ask() formats the messages itself so a broken reply can be continued.
const toText = (llm) => llm.pipe(new StringOutputParser());
const clarifyChain = { prompt: clarifyPrompt, llm: toText(model) };
const rulesChain = { prompt: rulesPrompt, llm: toText(model) };
const translateChain = { prompt: translatePrompt, llm: toText(model) };
const repairChain = { prompt: repairPrompt, llm: toText(model) };
const styleChain = { prompt: null, llm: toText(styleModel) };

// Streams a model reply, showing elapsed time and characters received, and aborts it once it
// has run for timeoutSeconds. Reasoning models may think for a while before the first character.
// A stream that breaks partway (provider dropped, 5xx, connection reset) is retried up to
// LLM_STREAM_RETRIES times, each with a fresh deadline. If real text had already arrived, it is kept
// and the retry asks the model to continue from where it stopped instead of starting over.
// The SDK's own retries only cover errors before the stream starts.
const streamRetries = Number(process.env.LLM_STREAM_RETRIES ?? 3);
if (!Number.isSafeInteger(streamRetries) || streamRetries < 0) {
  throw new Error("LLM_STREAM_RETRIES must be a nonnegative integer.");
}

function isTransient(error) {
  const code = Number(error?.status ?? error?.code ?? error?.error?.code);
  if (code === 429 || (code >= 500 && code < 600)) return true;
  if (error?.error?.metadata?.error_type === "provider_unavailable") return true;
  return /network|connection|socket|ECONNRESET|ETIMEDOUT|terminated|fetch failed/i.test(String(error?.message));
}

async function ask(task, chain, input) {
  const messages = chain.prompt ? await chain.prompt.formatMessages(input) : input;
  let partial = "";
  for (let attempt = 0; ; attempt++) {
    try {
      const request = partial ? continuationMessages(messages, partial) : messages;
      const more = await askOnce(partial ? `continue: ${task}` : task, chain.llm, request, partial.length);
      return partial ? joinContinuation(partial, more) : more;
    } catch (error) {
      if (error.timedOut || attempt >= streamRetries || !isTransient(error)) throw error;
      const received = error.partial ?? "";
      const kept = partial ? joinContinuation(partial, received) : received;
      partial = kept.length >= minContinueChars ? kept : "";
      const wait = 5 * 2 ** attempt;
      const plan = partial ? `Keeping ${partial.length} characters and continuing from there` : "Retrying";
      console.log(`${modelLabel} failed mid-reply (${error.message}). ${plan} in ${wait}s (${attempt + 1}/${streamRetries})...`);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    }
  }
}

// One streamed request. `already` is how many characters earlier attempts kept, for the status line.
async function askOnce(task, llm, messages, already = 0) {
  console.log(`\nWaiting for ${modelLabel} to ${task} (limit ${timeoutSeconds}s)...`);
  const start = Date.now();
  const elapsed = () => Math.round((Date.now() - start) / 1000);
  let reply = "";
  // Reasoning models think silently first, so several minutes with no output is normal.
  const status = () => reply.length
    ? `  ${elapsed()}s, ${reply.length} characters received${already ? ` (+${already} kept)` : ""}`
    : `  ${elapsed()}s, model is thinking (no output yet; this can take several minutes)`;
  // On a terminal the status line updates in place; in a log it is printed every 30s.
  const tty = process.stdout.isTTY;
  const ticker = setInterval(
    () => (tty ? process.stdout.write(`\r${status()}\x1b[K`) : console.log(status())),
    tty ? 1000 : 30000,
  );
  const signal = AbortSignal.timeout(timeoutSeconds * 1000);
  try {
    const stream = await llm.stream(messages, { signal });
    for await (const chunk of stream) reply += chunk;
  } catch (error) {
    if (signal.aborted) {
      const timeout = new Error(
        `${modelLabel} did not finish (${task}) within ${timeoutSeconds}s; ${reply.length} characters had arrived. ` +
        "Raise LLM_TIMEOUT or try again.",
        { cause: error },
      );
      timeout.timedOut = true;
      throw timeout;
    }
    error.partial = reply;
    throw error;
  } finally {
    clearInterval(ticker);
    if (tty) process.stdout.write("\n");
  }
  console.log(`Finished in ${elapsed()}s (${reply.length} characters).`);
  return reply;
}

// Design questions need someone at the keyboard; CLARIFY=false turns them off.
function wantsQuestions() {
  if (/^(0|false|no)$/i.test(process.env.CLARIFY ?? "")) return false;
  return Boolean(process.stdin.isTTY);
}

async function run(idea) {
  const maxRepairs = Number(process.env.MAX_REPAIRS ?? 5);
  if (!Number.isSafeInteger(maxRepairs) || maxRepairs < 0) {
    throw new Error("MAX_REPAIRS must be a nonnegative integer.");
  }
  const examples = await loadExamples();
  const contract = await fs.readFile(path.join(projectDir, "contract.md"), "utf8");
  // STYLE=name[,name...] picks reference images in styles/ (checked now, so a typo fails before any API call).
  const styleFiles = await resolveStyle(process.env.STYLE, path.join(projectDir, "styles"));

  // RULES=path/to/rules.md reuses rules from an earlier run instead of writing new ones.
  // Otherwise the model first asks design questions (CLARIFY=false or a non-interactive run skips them).
  let preferences = formatPreferences([]);
  if (!process.env.RULES && wantsQuestions()) {
    const questions = parseQuestions(await ask("think of design questions", clarifyChain, { idea }));
    if (questions.length) preferences = formatPreferences(await askQuestions(questions));
    else console.log("No design questions; the idea is specific enough.");
    console.log(`\nDesign brief:\n${preferences}`);
  }
  // The rules reply also carries design notes (why each rule, where it comes from, how rules interact).
  // Only the rules go on to the code prompts. Reused rules bring the design-notes.md saved next to them.
  const rulesSource = process.env.RULES && path.resolve(process.env.RULES);
  const { rules, notes: newNotes } = splitDesignNotes(rulesSource
    ? await fs.readFile(rulesSource, "utf8")
    : await ask("write the rules", rulesChain, { examples, idea, preferences }));
  const notes = newNotes ?? (rulesSource
    ? await fs.readFile(path.join(path.dirname(rulesSource), "design-notes.md"), "utf8").catch(() => null)
    : null);
  console.log("RULES:\n", rules);
  if (!notes && !rulesSource) console.log("(The model did not write design notes this time; design-notes.md is skipped.)");

  // A unique directory keeps every attempt and its validation feedback together. It is created
  // before the code is written so the rules survive if a later step fails.
  const outputs = path.join(projectDir, "outputs");
  await fs.mkdir(outputs, { recursive: true });
  const outDir = await fs.mkdtemp(path.join(outputs, `${new Date().toISOString().replace(/[:.]/g, "-")}-`));
  const rulesFile = path.join(outDir, "rules.md");
  await fs.writeFile(rulesFile, rules + "\n");
  if (notes) await fs.writeFile(path.join(outDir, "design-notes.md"), notes.trimEnd() + "\n");
  // Reused rules and style guides are listed by path so the brief shows where they came from.
  const source = (file) => (file.endsWith(".md") ? path.relative(projectDir, file) : path.basename(file));
  const answers = process.env.RULES
    ? `(not asked: rules reused from ${source(path.resolve(process.env.RULES))})`
    : preferences;
  const styleNote = styleFiles.length ? `\nArt style from: ${styleFiles.map(source).join(", ")}\n` : "";
  await fs.writeFile(path.join(outDir, "brief.md"), `Idea: ${idea}\n\nAnswers:\n${answers}\n${styleNote}`);
  console.log(`Rules saved to ${rulesFile} (rerun with RULES=${path.relative(process.cwd(), rulesFile)} to reuse them).`);
  if (notes) console.log(`Design notes (why each rule, and how the rules connect) saved to ${path.join(outDir, "design-notes.md")}.`);

  // A style.md (from an earlier run) is used as is; images are described by the vision model.
  let style = noStyle;
  if (styleFiles.length) {
    const guides = [];
    for (const file of styleFiles.filter((f) => f.endsWith(".md"))) guides.push(await fs.readFile(file, "utf8"));
    const images = styleFiles.filter((f) => !f.endsWith(".md"));
    if (images.length) {
      // Each image is described once; the guide is saved next to it (styles/<name>.md) and reused.
      const cachePath = styleCachePath(images);
      const digest = await imageDigest(images);
      let described = await readCachedGuide(cachePath, digest);
      if (described) {
        console.log(`\nUsing the saved style guide ${path.relative(process.cwd(), cachePath)} (delete it to describe the image again).`);
      } else {
        try {
          described = await ask(`describe the art style of ${images.map((f) => path.basename(f)).join(", ")}`,
            styleChain, await styleMessages(images));
        } catch (error) {
          if (!error.timedOut) error.message += " (if the model cannot read images, set STYLE_MODEL to a vision model or use PROVIDER=gemini)";
          throw error;
        }
        await writeCachedGuide(cachePath, digest, images, described);
        console.log(`Style guide saved to ${path.relative(process.cwd(), cachePath)}; later runs with this image reuse it.`);
      }
      guides.push(described);
    }
    const guide = guides.join("\n\n").trim();
    const styleFile = path.join(outDir, "style.md");
    await fs.writeFile(styleFile, guide + "\n");
    style = formatStyle(guide, styleFiles);
    console.log(`\nART STYLE:\n${guide}\nStyle saved to ${styleFile} (rerun with STYLE=${path.relative(process.cwd(), styleFile)} to reuse it).`);
  }

  const code = extractCode(await ask("write game.js", translateChain, { examples, rules, contract, style }));
  console.log(`\nGenerated ${code.length} characters of JavaScript.`);

  const { validation } = await repairUntilPlayable({
    code, rules, examples, outDir, maxRepairs,
    repair: (input) => ask("repair game.js", repairChain, { ...input, contract, style }),
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
