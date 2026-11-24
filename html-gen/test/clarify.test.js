import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { parseQuestions, interpretAnswer, formatPreferences, askQuestions } from "../src/clarify.js";

test("parseQuestions reads a fenced JSON array and drops bad entries", () => {
  const reply = 'Sure!\n```json\n[{"question": "Kind?", "options": ["Card game", " Dice ", 3]}, {"nope": 1}]\n```';
  assert.deepEqual(parseQuestions(reply), [{ question: "Kind?", options: ["Card game", "Dice"] }]);
  assert.deepEqual(parseQuestions('[{"question": "Players?"}]'), [{ question: "Players?", options: [] }]);
  assert.deepEqual(parseQuestions("[]"), []);
  assert.deepEqual(parseQuestions("no idea"), []);
  assert.deepEqual(parseQuestions("```json\n[{broken\n```"), []);
});

test("interpretAnswer maps numbers, free text, and Enter", () => {
  const options = ["Card game", "Dice game"];
  assert.equal(interpretAnswer("2", options), "Dice game");
  assert.equal(interpretAnswer("", options), null);
  assert.equal(interpretAnswer("3", options), undefined); // "Other" asks for text
  assert.equal(interpretAnswer("a snake racing game", options), "a snake racing game");
  assert.equal(interpretAnswer("7", options), "7");
});

test("formatPreferences lists only answered questions", () => {
  assert.match(formatPreferences([]), /designer decides/);
  assert.equal(
    formatPreferences([{ question: "Kind?", answer: "Card game" }, { question: "Theme?", answer: null }]),
    "- Kind? Card game",
  );
});

test("askQuestions reads options, Other, and skips from the terminal", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  const questions = [
    { question: "Kind?", options: ["Card game", "Board game"] },
    { question: "Players?", options: ["2", "3-4"] },
    { question: "Theme?", options: ["Jungle"] },
  ];
  const log = console.log;
  console.log = () => {};
  try {
    const pending = askQuestions(questions, { input, output });
    for (const line of ["1", "3", "exactly 5 players", ""]) {
      await new Promise((r) => setImmediate(r));
      input.write(line + "\n");
    }
    assert.deepEqual(await pending, [
      { question: "Kind?", answer: "Card game" },
      { question: "Players?", answer: "exactly 5 players" },
      { question: "Theme?", answer: null },
    ]);
  } finally {
    console.log = log;
  }
});
