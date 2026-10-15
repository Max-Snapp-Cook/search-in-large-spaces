import "dotenv/config";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const failure = (stage, message, diagnostics = "") => ({
  ok: false, stage, errors: [message], stats: null, diagnostics,
});

function execute(command, args, options) {
  return new Promise((resolve) => {
    execFile(command, args, {
      cwd: projectDir, windowsHide: true, encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024, ...options,
    }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
  });
}

export function parseBridgeResult({ error, stdout, stderr }) {
  if (error?.killed) return failure("timeout", "Ludii exceeded the process time limit.", stderr);
  if (error?.code === "ENOENT") return failure("setup", "Java was not found. Install a JDK and put java on PATH.");
  if (error && typeof error.code !== "number") return failure("process", error.message, stderr);
  try {
    const result = JSON.parse(stdout.trim());
    if (typeof result.ok !== "boolean" || typeof result.stage !== "string" || !Array.isArray(result.errors)) {
      throw new Error("Unexpected bridge response shape");
    }
    if (error && result.ok) return failure("process", "Java exited unsuccessfully despite reporting success.", stderr);
    return { ...result, diagnostics: stderr.trim() };
  } catch {
    return failure("process", "Java did not return a valid bridge result. Check the JAR, compiled bridge, and Java version.", `${stderr}\n${stdout}`.trim());
  }
}

export async function buildBridge({
  jarPath = process.env.LUDII_JAR || path.join(projectDir, "Ludii.jar"),
  javac = process.env.JAVAC_BIN || "javac",
} = {}) {
  const jar = path.resolve(jarPath);
  try { await fs.access(jar); }
  catch { return failure("setup", `Ludii JAR not found: ${jar}. Set LUDII_JAR in .env.`); }
  const { error, stdout, stderr } = await execute(javac, [
    "-encoding", "UTF-8", "-cp", jar, "-d", projectDir, path.join(projectDir, "LudiiBridge.java"),
  ], { timeout: 60_000 });
  if (error) return failure("setup", "Could not build LudiiBridge. Install a JDK, check JAVAC_BIN and LUDII_JAR.", `${stderr}\n${stdout}\n${error.message}`.trim());
  return { ok: true, stage: "build", errors: [], diagnostics: stderr.trim() };
}

export async function validateWithLudii(file, {
  playouts = 0, maxMoves = 500, timeoutMs = 60_000,
  jarPath = process.env.LUDII_JAR || path.join(projectDir, "Ludii.jar"),
  java = process.env.JAVA_BIN || "java",
} = {}) {
  if (!Number.isSafeInteger(playouts) || playouts < 0 ||
      !Number.isSafeInteger(maxMoves) || maxMoves < 1 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    return failure("input", "playouts must be a nonnegative integer; maxMoves and timeoutMs must be positive integers.");
  }
  if (typeof file !== "string" || !file) return failure("input", "Provide a .lud file path.");
  const gameFile = path.resolve(file);
  const jar = path.resolve(jarPath);
  try { await fs.access(gameFile); }
  catch { return failure("input", `Game file not found: ${gameFile}`); }
  for (const required of [jar, path.join(projectDir, "LudiiBridge.class")]) {
    try { await fs.access(required); }
    catch { return failure("setup", `Missing ${required}. Set LUDII_JAR and run npm run build:bridge.`); }
  }
  return parseBridgeResult(await execute(java, [
    "-Djava.awt.headless=true", "-Dfile.encoding=UTF-8", "-cp",
    [jar, projectDir].join(path.delimiter), "LudiiBridge",
    gameFile, String(playouts), String(maxMoves),
  ], { timeout: timeoutMs }));
}

// Only these stages describe game failures that an LLM should try to fix.
export function repairFeedback(result) {
  if (result.ok || !["compile", "initialize", "playout"].includes(result.stage)) return null;
  return [`Ludii failed during ${result.stage}.`, ...result.errors, result.diagnostics || ""].join("\n").slice(0, 20_000);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, playouts = "0", maxMoves = "500"] = process.argv.slice(2);
  const result = file === "--build"
    ? await buildBridge()
    : await validateWithLudii(file, { playouts: Number(playouts), maxMoves: Number(maxMoves) });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
