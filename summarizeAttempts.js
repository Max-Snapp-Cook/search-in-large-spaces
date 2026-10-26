import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] || "outputs");
const destination = path.join(root, "attempts-summary.json");

// Collapse embedded source listings and stack traces, but retain token names.
function normalizeError(error) {
  let text = error.replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  text = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "Unspecified error";
  return text.replace(/\s+/g, " ").trim();
}

function category(error) {
  if (/Couldn't find ludeme class for token/i.test(error)) return "Unknown ludeme or macro";
  if (/Couldn't find token/i.test(error)) return "Unknown token";
  if (/Unexpected syntax/i.test(error)) return "Unexpected syntax";
  if (/no specific error was identified/i.test(error)) return "Compilation failed without a specific error";
  return error;
}

async function findReports(dir) {
  const found = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await findReports(file));
    else if (entry.isFile() && /^attempt-\d+\.json$/.test(entry.name)) found.push(file);
  }
  return found;
}

const files = (await findReports(root)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const attempts = [];
const readErrors = [];
const exact = new Map();
const categories = new Map();
const stages = {};

function count(map, key, source, run) {
  if (!map.has(key)) map.set(key, { error: key, attemptCount: 0, runs: new Set(), sources: [] });
  const item = map.get(key);
  item.attemptCount++;
  item.runs.add(run);
  item.sources.push(source);
}

for (const file of files) {
  const source = path.relative(root, file).split(path.sep).join("/");
  const run = path.dirname(source);
  try {
    const report = JSON.parse((await fs.readFile(file, "utf8")).replace(/^\uFEFF/, ""));
    if (!report || typeof report.ok !== "boolean" || typeof report.stage !== "string"
        || !Array.isArray(report.errors) || !report.errors.every((error) => typeof error === "string")) {
      throw new Error("Expected a validation report with ok, stage, and string errors array");
    }
    // Full source reports (including diagnostics) are retained for later analysis.
    attempts.push({ source, run, attempt: Number(path.basename(file).match(/\d+/)[0]), report });
    stages[report.stage] = (stages[report.stage] || 0) + 1;
    if (!report.ok) {
      const errors = new Set(report.errors.length ? report.errors.map(normalizeError) : ["Failure without an error message"]);
      for (const error of errors) count(exact, error, source, run);
      for (const group of new Set([...errors].map(category))) count(categories, group, source, run);
    }
  } catch (error) {
    readErrors.push({ source, error: error.message });
  }
}

function ranking(map) {
  return [...map.values()].map(({ runs, ...item }) => ({ ...item, runCount: runs.size }))
    .sort((a, b) => b.attemptCount - a.attemptCount || a.error.localeCompare(b.error));
}

const summary = {
  generatedAt: new Date().toISOString(),
  sourceDirectory: root,
  countingMethod: "Each distinct normalized error/category counts once per failed attempt. Diagnostics are preserved but not counted again. Only attempt-N.json files are included; rules-attempt-N.json and result.json are excluded. runCount counts distinct containing folders.",
  totals: {
    filesFound: files.length, reportsRead: attempts.length, unreadableReports: readErrors.length,
    runs: new Set(attempts.map((attempt) => attempt.run)).size,
    successfulAttempts: attempts.filter((attempt) => attempt.report.ok).length,
    failedAttempts: attempts.filter((attempt) => !attempt.report.ok).length,
  },
  stages,
  errorCategories: ranking(categories),
  commonErrors: ranking(exact),
  readErrors,
  attempts,
};
await fs.writeFile(destination, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ file: destination, ...summary.totals, topCategories: summary.errorCategories.slice(0, 8).map(({ sources, ...item }) => item), topErrors: summary.commonErrors.slice(0, 8).map(({ sources, ...item }) => item) }, null, 2));
if (readErrors.length) process.exitCode = 1;
