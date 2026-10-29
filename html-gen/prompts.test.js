import test from "node:test";
import assert from "node:assert/strict";
import { rulesPrompt, translatePrompt, repairPrompt } from "./prompts.js";

test("prompts format with only the pipeline's inputs", async () => {
  const input = { idea: "idea", examples: "<html>{}</html>", rules: "rules", code: "{ x: 1 }", errors: "errors", contract: "result(state): { winner }" };
  for (const prompt of [rulesPrompt, translatePrompt, repairPrompt]) {
    const text = (await prompt.formatMessages(input)).map((m) => m.content).join("\n");
    assert.doesNotMatch(text, /\{\{/);
  }
  const repair = (await repairPrompt.formatMessages(input)).at(-1).content;
  assert.match(repair, /\{ winner \}/);
});
