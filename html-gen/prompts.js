// prompts.js
// Holds the prompt templates used by the pipeline.
// {contract} is contract.md, passed as a value so its code braces are not template variables.
import { ChatPromptTemplate } from "@langchain/core/prompts";

// Generate the rules from the game idea
const rulesPrompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a tabletop game designer. Your games are implemented as browser games in JavaScript."],
  ["human",
`Reference games:
{examples}

Design a new game based on this idea: {idea}

Any kind of tabletop game is possible: abstract board games, card games (standard 52-card deck or custom cards),
dice games, economic and trading games, tile and resource-building games, race games, and solo puzzles,
for 1 to 8 players, with hidden information and chance where the idea calls for them.

Write complete plain-English rules: number of players, components (board, pieces, cards, dice, money, resources),
setup, turn structure, legal moves, what each player can and cannot see, scoring, and how the game ends.
Trades, bids, and payments use a small set of fixed options. Create a unique and creative game rather than copying
a well-known one. Make sure every game is guaranteed to end (add a round limit with a scoring tiebreak if needed).
Start with the game's name. No code.`],
]);

// Translate the rules into game.js
const translatePrompt = ChatPromptTemplate.fromMessages([
  ["system", "You implement tabletop game rules as polished, visually striking browser games in JavaScript."],
  ["human",
`Reference games:
{examples}

Rules:
{rules}

{contract}

Output ONLY the complete game.js inside a single \`\`\`javascript code block.`],
]);

// Repair prompt: fixes broken games using feedback from the headless validator
const repairPrompt = ChatPromptTemplate.fromMessages([
  ["system", "You repair JavaScript browser games using error feedback from a headless validator."],
  ["human",
`Reference games:
{examples}

Original rules:
{rules}

Current game.js:
{code}

Validator feedback:
{errors}

{contract}

How the validator works: it loads game.js inside the shell page in jsdom (no real layout or canvas) and fails on any
uncaught exception. It checks the GameEngine/GameView contract, then plays random games at the minimum, default,
and maximum player counts using only GameEngine, checking on every move that applyMove is deterministic and does not
mutate its input, results are valid, and (for hidden games) that determinize keeps what the player can see. Next it
plays games through the shell for each player count (calling GameView update after every move, plus undo and
restart) and clicks every element in the board container. Finally it runs the computer opponent's search from a
few positions, which calls determinize and evaluate.

Fix every reported error, then review the entire file for related bugs: the validator may stop at the first failure.
Preserve the original rules as closely as possible. Make all necessary corrections, but avoid unrelated changes.
Do not return the same failing code unchanged.
Return the complete corrected game.js, not a patch or a partial snippet.
Output ONLY the complete game.js inside a single \`\`\`javascript code block.`],
]);

export { rulesPrompt, translatePrompt, repairPrompt };
