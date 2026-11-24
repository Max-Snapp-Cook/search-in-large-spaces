import test from "node:test";
import assert from "node:assert/strict";
import { clarifyPrompt, rulesPrompt, translatePrompt, repairPrompt } from "../src/prompts.js";

test("prompts format with only the pipeline's inputs", async () => {
  const input = { idea: "idea", preferences: "- Players? 2", examples: "<html>{}</html>", rules: "rules", code: "{ x: 1 }", errors: "errors", contract: "result(state): { winner }", style: "- Palette: #112233 {bold}" };
  for (const prompt of [clarifyPrompt, rulesPrompt, translatePrompt, repairPrompt]) {
    const text = (await prompt.formatMessages(input)).map((m) => m.content).join("\n");
    assert.doesNotMatch(text, /\{\{/);
  }
  const repair = (await repairPrompt.formatMessages(input)).at(-1).content;
  assert.match(repair, /\{ winner \}/);
  for (const prompt of [translatePrompt, repairPrompt]) {
    const text = (await prompt.formatMessages(input)).at(-1).content;
    assert.match(text, /#112233 \{bold\}/);
  }
});
