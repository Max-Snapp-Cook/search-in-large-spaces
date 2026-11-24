// prompts.js
// Holds the prompt templates used by the pipeline.
// {contract} is contract.md and {style} the art style guide, passed as values so their braces are not template variables.
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { NOTES_MARKER } from "./designNotes.js";

// Ask the player a few design questions about the idea before the rules are written
const clarifyPrompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a tabletop game designer interviewing a player about the game they want before you design it."],
  ["human",
`The player wants a game based on this idea: {idea}

Write up to 5 short multiple-choice questions whose answers would most change the design. Always cover the kind of
game (for example card game, abstract board game like chess or checkers, dice game, race game, tile placement,
area control) and the number of players, unless the idea already settles them. Other good topics: theme and
setting, game length, amount of luck vs strategy, hidden information, competitive vs cooperative, complexity.
Skip anything the idea already answers. Give each question 3 to 5 concrete options that fit this particular idea
(not generic placeholders). The player can always type their own answer, so don't add an "other" option.

Output ONLY a JSON array inside a single \`\`\`json code block, in this form:
[{{"question": "What kind of game should it be?", "options": ["Card game", "Chess-like board game", "Dice game"]}}]
If the idea is already fully specified, output [].`],
]);

// Generate the rules from the game idea
const rulesPrompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a tabletop game designer. Your games are implemented as browser games in JavaScript."],
  ["human",
`Reference games:
{examples}

Design a new game based on this idea: {idea}

The player's answers to your design questions (follow these; decide anything left open yourself):
{preferences}

Any kind of tabletop game is possible: abstract board games, card games (standard 52-card deck or custom cards),
dice games, economic and trading games, tile and resource-building games, race games, and solo puzzles,
for 1 to 8 players, with hidden information and chance where the idea calls for them.

Write complete plain-English rules: number of players, components (board, pieces, cards, dice, money, resources),
setup, turn structure, legal moves, what each player can and cannot see, scoring, and how the game ends.
Trades, bids, and payments use a small set of fixed options. Create a unique and creative game rather than copying
a well-known one. Make sure every game is guaranteed to end (add a round limit with a scoring tiebreak if needed).
Start with the game's name. No code.

After the rules, write a line containing only ${NOTES_MARKER} and then your design notes, which explain how
you arrived at these rules. They are read by researchers studying how designs are made, so be candid and specific:

# Design notes: <game name>

## Concept
2-3 sentences: the core idea, and the experience the rules are meant to create.

## Rules and why
One entry per rule or mechanic that shapes play (setup details only if they matter), in this form:
### <short rule name>
- Rule: one sentence.
- Origin: one of "New" (you made it up for this game), "Adapted from <game or genre>: <what you changed>",
  or "Borrowed from <game or genre>" (used as is). Many mechanics are standard (roll-and-move, trick-taking,
  set collection, worker placement): say so plainly. Do not call something new if it is a familiar mechanic.
- Why: the problem it solves or the decision/feeling it creates; mention alternatives you considered and rejected.
- Connects to: the other rules it is built to interact with, and how.

## Interactions
The 2-4 rule combinations you designed to play off each other: "<rule A> + <rule B>: what happens when they
meet, and why that makes play interesting (a dilemma, a combo, a comeback, a bluff)".

## What is new here
2-4 bullets: which parts of the design are original and which are a familiar base, and what the game would lose
without the new parts.`],
]);

// Translate the rules into game.js
const translatePrompt = ChatPromptTemplate.fromMessages([
  ["system", "You implement tabletop game rules as polished, visually striking browser games in JavaScript."],
  ["human",
`Reference games:
{examples}

Rules:
{rules}

Art style:
{style}

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

Art style (keep the game looking like this while fixing it):
{style}

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

export { clarifyPrompt, rulesPrompt, translatePrompt, repairPrompt };
