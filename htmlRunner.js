import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { runPlaytests } from "./playtests.js";
import { validatePlaytests } from "./designContracts.js";
import { runTraversal, validateTraversalPlan } from "./traversal.js";
import { parseArgs } from "node:util";

const failure = (stage, message) => ({ ok: false, stage, errors: [message], diagnostics: "" });

export function repairFeedback(result) {
  if (result.ok || !["document", "browser", "behavior", "traversal", "quality", "timeout"].includes(result.stage)) return null;
  const behavior = result.playtests?.filter(test => !test.ok).map(test => ({ id: test.id, purpose: test.purpose, levelId: test.levelId, setup: test.setup, stalled: test.stalled, timing: test.timing, failedStep: test.failedStep, elapsedMs: test.elapsedMs, before: test.before, after: test.after, recentSteps: test.trace?.slice(-4), error: test.error }));
  return [`HTML validation failed during ${result.stage}.`, ...result.errors,
    behavior?.length ? `Behavior failure evidence (hold releases its keys; use keys:[...] for simultaneous inputs or down/up for persistent input):\n${JSON.stringify(behavior)}` : "",
    result.traversal ? JSON.stringify(result.traversal) : "", result.diagnostics || ""].join("\n").slice(0, 30_000);
}

// Serve only the candidate document; never expose the repository or other runs.
export async function validateHtml(file, { timeoutMs = 15_000, smokeMs = 750, playtests, traversal = false } = {}) {
  if (typeof file !== "string" || !/\.html$/i.test(file) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
      !Number.isSafeInteger(smokeMs) || smokeMs < 0) {
    return failure("input", "Provide an .html file, positive integer timeoutMs and nonnegative integer smokeMs.");
  }
  if (playtests) {
    try { validatePlaytests(playtests); }
    catch (error) { return failure("input", error.message); }
  }
  if (traversal && traversal !== true) {
    try { validateTraversalPlan(traversal); }
    catch (error) { return failure("input", error.message); }
  }
  let html;
  try { html = await fs.readFile(file, "utf8"); }
  catch (error) { return failure("input", error.message); }
  if (!/<!doctype\s+html\s*>/i.test(html) || !/<html\b/i.test(html) || !/<head\b/i.test(html) || !/<body\b/i.test(html)) {
    return failure("document", "Return a complete HTML document with DOCTYPE, html, head and body.");
  }
  const server = http.createServer((req, res) => {
    if (req.url === "/game.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(html);
    } else if (req.url === "/favicon.ico") { res.writeHead(204); res.end(); }
    else { res.writeHead(404); res.end("All game resources must be inline."); }
  });
  let browser, timer;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try { browser = await chromium.launch({ timeout: timeoutMs }); }
    catch (error) { return failure("setup", `Cannot launch Chromium. Run npm run browser:install. ${error.message}`); }
    const errors = [];
    const diagnostics = [];
    const origin = `http://127.0.0.1:${server.address().port}`;
    const check = async () => {
      const createContext = async () => {
        const context = await browser.newContext({ serviceWorkers: "block" });
        await context.route("**/*", async (route) => {
          const url = route.request().url();
          if (url.startsWith(`${origin}/`) || /^(data:|blob:)/.test(url)) await route.continue();
          else { errors.push(`External resource forbidden: ${url}`); await route.abort(); }
        });
        context.setDefaultTimeout(timeoutMs);
        // Scenarios have independent clocks/contexts; collect errors from every
        // page, including script initialization and real input handlers.
        context.on("page", page => {
          page.on("pageerror", error => errors.push(error.stack || error.message));
          page.on("console", message => {
            if (message.type() === "error") errors.push(message.text());
            else diagnostics.push(message.text());
          });
          page.on("requestfailed", request => errors.push(`Request failed: ${request.url()} ${request.failure()?.errorText}`));
          page.on("response", response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`); });
        });
        return context;
      };
      const context = await createContext();
      const page = await context.newPage();
      await page.goto(`${origin}/game.html`, { waitUntil: "load", timeout: timeoutMs });
      const structure = await page.evaluate(() => ({
        canvas: !!document.querySelector("canvas"),
        script: [...document.scripts].some(s => !s.src && s.textContent.trim() && (!s.type || ["module", "text/javascript", "application/javascript"].includes(s.type))),
      }));
      if (!structure.canvas || !structure.script) errors.push("Platformer requires a canvas and executable inline JavaScript.");
      let tests;
      if (playtests) {
        tests = await runPlaytests(page, playtests, { createContext, html });
        for (const test of tests) if (!test.ok) errors.push(`Playtest ${test.id}: ${test.error}`);
      } else {
        await page.keyboard.down("ArrowRight");
        await page.keyboard.press("Space");
        await page.waitForTimeout(smokeMs);
        await page.keyboard.up("ArrowRight");
        await page.keyboard.press("r");
        await page.waitForTimeout(smokeMs);
      }
      let reachability;
      if (traversal && errors.length === 0) {
        reachability = await runTraversal(page, traversal);
        errors.push(...reachability.errors);
      }
      return { ok: errors.length === 0, stage: errors.length ? reachability?.ok === false ? "traversal" : tests?.some(t => !t.ok) ? "behavior" : "browser" : "complete", errors: [...new Set(errors)], diagnostics: diagnostics.join("\n").slice(0, 20_000), validationScope: traversal ? "startup, behavior and traversal witnesses" : "startup/behavior only; reachability not checked", ...(tests ? { playtests: tests } : {}), ...(reachability ? { traversal: reachability } : {}) };
    };
    return await Promise.race([
      check(),
      new Promise(resolve => { timer = setTimeout(() => resolve(failure("timeout", "Browser validation exceeded its time limit; check for infinite loops or blocking scripts.")), timeoutMs); }),
    ]);
  } catch (error) { return failure(browser ? "browser" : "setup", error.message); }
  finally {
    clearTimeout(timer);
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { "smoke-only": { type: "boolean", default: false }, design: { type: "string" } } });
  if (positionals.length !== 1) throw new Error("Usage: npm run validate -- game.html [--design design.json] [--smoke-only]");
  let expected = true;
  if (values.design) {
    const design = JSON.parse(await fs.readFile(values.design, "utf8"));
    validateTraversalPlan(design.traversal);
    expected = design.traversal;
  }
  const result = await validateHtml(positionals[0], { traversal: values["smoke-only"] ? false : expected, timeoutMs: 120_000 });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
