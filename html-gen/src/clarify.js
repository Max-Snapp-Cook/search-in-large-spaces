// clarify.js
// Before the rules are written, the LLM asks a few design questions about the idea (game type,
// player count, theme...). Each question offers the LLM's own options plus a free-text answer.

import readline from "node:readline/promises";

// Pulls the question list out of the model's reply. Accepts a ```json block or a bare array,
// and returns [] (no questions) if the reply cannot be understood.
export function parseQuestions(reply) {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let text = fenced ? fenced[1] : reply;
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end < start) return [];
  text = text.slice(start, end + 1);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data
    .filter((q) => q && typeof q.question === "string" && q.question.trim())
    .map((q) => ({
      question: q.question.trim(),
      options: (Array.isArray(q.options) ? q.options : [])
        .filter((o) => typeof o === "string" && o.trim())
        .map((o) => o.trim())
        .slice(0, 6),
    }))
    .slice(0, 6);
}

// Turns one typed line into an answer: a listed number picks that option, Enter leaves it to the
// designer, and anything else is taken as the player's own answer.
export function interpretAnswer(line, options) {
  const text = line.trim();
  if (!text) return null;
  const n = Number(text);
  if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1];
  if (Number.isInteger(n) && n === options.length + 1) return undefined; // "type your own" chosen
  return text;
}

// Formats the answers for the rules prompt.
export function formatPreferences(answers) {
  const answered = answers.filter((a) => a.answer);
  if (!answered.length) return "(none: the designer decides everything)";
  return answered.map((a) => `- ${a.question} ${a.answer}`).join("\n");
}

// Asks each question on the terminal and returns [{ question, answer }] (answer null = no preference).
export async function askQuestions(questions, { input = process.stdin, output = process.stdout } = {}) {
  const rl = readline.createInterface({ input, output });
  const answers = [];
  try {
    console.log("\nA few questions before designing the game (Enter = let the designer decide):");
    for (const [i, { question, options }] of questions.entries()) {
      console.log(`\n${i + 1}. ${question}`);
      options.forEach((o, j) => console.log(`   ${j + 1}) ${o}`));
      console.log(`   ${options.length + 1}) Other (type your own)`);
      let answer = interpretAnswer(await rl.question("> "), options);
      while (answer === undefined) {
        answer = (await rl.question("Your answer: ")).trim() || null;
      }
      answers.push({ question, answer });
    }
  } finally {
    rl.close();
  }
  return answers;
}
