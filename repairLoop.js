import fs from "node:fs/promises";
import path from "node:path";
import { validateWithLudii, repairFeedback } from "./ludiiRunner.js";

export function extractLud(text) {
  const match = text.match(/```(?:lud)?\s*([\s\S]*?)```/);
  return (match ? match[1] : text).trim();
}

export async function repairUntilPlayable({
  code, rules, examples, outDir, repair,
  maxRepairs = 5, validationOptions = {}, validate = validateWithLudii,
}) {
  if (!Number.isSafeInteger(maxRepairs) || maxRepairs < 0) {
    throw new Error("maxRepairs must be a nonnegative integer.");
  }
  await fs.mkdir(outDir, { recursive: true });
  const saveJson = (file, value) => fs.writeFile(path.join(outDir, file), JSON.stringify(value, null, 2));
  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    const file = path.join(outDir, `attempt-${attempt}.lud`);
    await fs.writeFile(file, code);
    const result = await validate(file, validationOptions);
    await saveJson(`attempt-${attempt}.json`, result);
    const errors = repairFeedback(result);
    const status = result.ok ? "validated" : errors === null ? "validation_failed"
      : attempt === maxRepairs ? "repair_limit_reached" : "repairing";
    const summary = { status, repairs: attempt, maxRepairs, lastAttempt: file, validation: result };
    await saveJson("result.json", summary);
    if (result.ok) {
      await fs.writeFile(path.join(outDir, "game.lud"), code);
      return summary;
    }
    if (status !== "repairing") {
      throw new Error(`${status}: ${result.errors.join("; ")}. See ${path.join(outDir, "result.json")}`);
    }
    console.log(`Attempt ${attempt} failed during ${result.stage}; requesting repair ${attempt + 1}/${maxRepairs}.`);
    try {
      code = extractLud(await repair({ examples, rules, code, errors }));
    } catch (error) {
      await saveJson("result.json", { ...summary, status: "repair_failed", error: error.message });
      throw error;
    }
  }
}
