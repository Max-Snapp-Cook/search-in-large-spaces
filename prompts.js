// prompts.js
// Holds the prompt templates used by the pipeline.
import { ChatPromptTemplate } from "@langchain/core/prompts";

// Generate the rules from the game idea
const rulesPrompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a board game designer. Your games must be implementable in the Ludii game system."],
  ["human",
`Reference Ludii games:
{examples}

Using these games as reference, design a new game based on this idea: {idea}

Write complete plain-English rules: board, pieces, setup, turns, legal moves, and how the game ends.
Use the example games as styles of games that are plausible but create a unique and creative game. Start with the game's name. No code.`],
]);

// Translate the rules into .lud code
const translatePrompt = ChatPromptTemplate.fromMessages([
  ["system", "You translate game rules into Ludii .lud code, using only ludemes that appear in the reference games."],
  ["human",
`Reference Ludii games:
{examples}

Rules:
{rules}

Output ONLY the .lud code inside a single \`\`\`lud code block.`],
]);

// Repair prompt: fixes broken .lud code using the error feedback from Ludii
const repairPrompt = ChatPromptTemplate.fromMessages([
  ["system", "You repair Ludii .lud code using error feedback from Ludii, using only ludemes that appear in the reference games."],
  ["human",
`Reference Ludii games:
{examples}

Original rules:
{rules}

Current .lud code:
{code}

Ludii error feedback:
{errors}

Fix every reported error, then review the entire game for additional syntax and compatibility errors.
Ludii may stop at the first error, so the feedback is not a complete list of problems. Do not stop after fixing only the named token.
Check board constructors and their arguments, direction names, site types, macro definitions and calls, move effects, scoring, ending conditions, and matching parentheses.
Use the reference games as evidence of valid syntax and argument structure. Do not invent ludemes, direction names, or graphics styles, or substitute another unsupported token for a reported invalid token.
Check that the chosen site types and adjacency rules are consistent across placement, capture, and territory scoring.
Review graphics metadata separately: compilation does not guarantee that a specialized board renderer supports the chosen board geometry. Omit optional board-style overrides when compatibility is uncertain.
Preserve the original rules as closely as possible. Make all necessary corrections, but avoid unrelated changes or replacing the game with a reference game.
Before returning the code, check that each reported problem has been addressed and that your changes have not introduced new inconsistencies. Do not return the same failing code unchanged.
Return the complete corrected game, not a patch or a partial snippet.
Output ONLY the .lud code inside a single \`\`\`lud code block.`],
]);

export { rulesPrompt, translatePrompt, repairPrompt };
