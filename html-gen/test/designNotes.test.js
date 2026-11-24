import test from "node:test";
import assert from "node:assert/strict";
import { splitDesignNotes, NOTES_MARKER } from "../src/designNotes.js";
import { rulesPrompt } from "../src/prompts.js";

test("the rules reply is split into rules and design notes", () => {
  const reply = `# Hexfall\n\nPlayers: 2\n\n${NOTES_MARKER}\n\n# Design notes: Hexfall\n\n## Rules and why\n### Collapse\n- Origin: New`;
  const { rules, notes } = splitDesignNotes(reply);
  assert.equal(rules, "# Hexfall\n\nPlayers: 2");
  assert.match(notes, /^# Design notes: Hexfall/);
  assert.doesNotMatch(rules, /Design notes/);
});

test("the marker survives markdown decoration, and a missing marker keeps everything as rules", () => {
  for (const marker of ["## === DESIGN NOTES ===", "**=== Design Notes ===**", "==== DESIGN NOTES ===="]) {
    const { rules, notes } = splitDesignNotes(`Rules here.\n${marker}\nWhy: fun.`);
    assert.equal(rules, "Rules here.", marker);
    assert.equal(notes, "Why: fun.", marker);
  }
  assert.deepEqual(splitDesignNotes("Just rules.\nA rule about === scores."), { rules: "Just rules.\nA rule about === scores.", notes: null });
  assert.deepEqual(splitDesignNotes(`Rules.\n${NOTES_MARKER}\n  `), { rules: "Rules.", notes: null });
});

test("the rules prompt asks for the marker, each rule's origin and reason, and the rule interactions", async () => {
  const text = (await rulesPrompt.formatMessages({ examples: "", idea: "x", preferences: "" })).at(-1).content;
  assert.ok(text.includes(NOTES_MARKER));
  assert.match(text, /Origin: .*New/s);
  assert.match(text, /Connects to:/);
  assert.match(text, /## Interactions/);
});
