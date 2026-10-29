import fs from "node:fs/promises";
import path from "node:path";
import { validateGame, repairFeedback, shellHtml } from "./gameRunner.js";

export function extractCode(text) {
  const match = text.match(/```(?:javascript|js)?\s*([\s\S]*?)```/);
  return (match ? match[1] : text).trim();
}

export async function repairUntilPlayable({
  code, rules, examples, outDir, repair,
  maxRepairs = 5, validationOptions = {}, validate = validateGame,
}) {
  if (!Number.isSafeInteger(maxRepairs) || maxRepairs < 0) {
    throw new Error("maxRepairs must be a nonnegative integer.");
  }
  await fs.mkdir(outDir, { recursive: true });
  const saveJson = (file, value) => fs.writeFile(path.join(outDir, file), JSON.stringify(value, null, 2));
  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    const file = path.join(outDir, `attempt-${attempt}.js`);
    await fs.writeFile(file, code);
    const result = await validate(file, validationOptions);
    await saveJson(`attempt-${attempt}.json`, result);
    const errors = repairFeedback(result);
    const status = result.ok ? "validated" : errors === null ? "validation_failed"
      : attempt === maxRepairs ? "repair_limit_reached" : "repairing";
    const summary = { status, repairs: attempt, maxRepairs, lastAttempt: file, validation: result };
    await saveJson("result.json", summary);
    if (result.ok) {
      // The playable site: open index.html, which loads game.js from the same folder.
      await fs.writeFile(path.join(outDir, "game.js"), code);
      await fs.writeFile(path.join(outDir, "index.html"), await shellHtml());
      return summary;
    }
    if (status !== "repairing") {
      throw new Error(`${status}: ${result.errors.join("; ")}. See ${path.join(outDir, "result.json")}`);
    }
    console.log(`Attempt ${attempt} failed during ${result.stage}; requesting repair ${attempt + 1}/${maxRepairs}.`);
    try {
      code = extractCode(await repair({ examples, rules, code, errors }));
    } catch (error) {
      await saveJson("result.json", { ...summary, status: "repair_failed", error: error.message });
      throw error;
    }
  }
}
