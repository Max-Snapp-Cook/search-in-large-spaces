import fs from "node:fs/promises";
import path from "node:path";
import { validateHtml, repairFeedback } from "./htmlRunner.js";

export function extractHtml(text) {
  const match = text.match(/```(?:html)?\s*([\s\S]*?)```/);
  return (match ? match[1] : text).trim();
}

export async function repairUntilPlayable({
  code, rules, outDir, repair, assess,
  maxRepairs = 15, validationOptions = {}, validate = validateHtml,
}) {
  if (!Number.isSafeInteger(maxRepairs) || maxRepairs < 0) {
    throw new Error("maxRepairs must be a nonnegative integer.");
  }
  await fs.mkdir(outDir, { recursive: true });
  const saveJson = (file, value) => fs.writeFile(path.join(outDir, file), JSON.stringify(value, null, 2));
  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    const file = path.join(outDir, `attempt-${attempt}.html`);
    await fs.writeFile(file, code);
    let result = await validate(file, validationOptions);
    await saveJson(`attempt-${attempt}.browser.json`, result);
    if (result.ok && assess) {
      try {
        const assessment = await assess({ code, file, attempt, validation: result });
        if (typeof assessment?.ok !== "boolean" || !Array.isArray(assessment.errors)) throw new Error("Invalid quality assessment.");
        result = { ...assessment, browser: result };
      } catch (error) {
        await saveJson("result.json", { status: "assessment_failed", repairs: attempt, lastAttempt: file, error: error.message });
        throw error;
      }
    }
    await saveJson(`attempt-${attempt}.json`, result);
    const errors = repairFeedback(result);
    const status = result.ok ? "validated" : errors === null ? "validation_failed"
      : attempt === maxRepairs ? "repair_limit_reached" : "repairing";
    const summary = { status, repairs: attempt, maxRepairs, lastAttempt: file, validation: result };
    await saveJson("result.json", summary);
    if (result.ok) {
      await fs.writeFile(path.join(outDir, "game.html"), code);
      return summary;
    }
    if (status !== "repairing") {
      throw new Error(`${status}: ${result.errors.join("; ")}. See ${path.join(outDir, "result.json")}`);
    }
    console.log(`Attempt ${attempt} failed during ${result.stage}; requesting repair ${attempt + 1}/${maxRepairs}.`);
    try {
      code = extractHtml(await repair({ rules, code, errors }));
    } catch (error) {
      await saveJson("result.json", { ...summary, status: "repair_failed", error: error.message });
      throw error;
    }
  }
}
