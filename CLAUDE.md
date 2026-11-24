# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A generator that turns a one-line game idea into a playable browser game. An LLM writes the
rules and then the JavaScript, a headless validator plays the game and reports errors, and
the LLM repairs the code until it passes. The result is a folder holding `index.html` +
`game.js` that runs from disk without a server.

The project used to generate Ludii `.lud` files. Commit `ca89245` replaced that with the
JavaScript generator. Nothing Ludii-related is left in the tree: all live code is in `html-gen/`.

## Commands

All code lives in `html-gen/` (Node, ES modules, no build step): source in `src/`, tests and fixtures in `test/`.

```sh
cd html-gen
npm install
npm run gen -- "a two-player capture game on a hexagonal board"   # generate a game
npm run validate -- test/fixtures/connect-four.js                  # validate, 20 playouts
npm run validate -- outputs/<run>/game.js 200 1000                 # playouts, move limit
npm test                                                           # node --test test/*.test.js
node --test test/gameRunner.test.js                                # one test file
```

`npm run gen` needs `BAYLEAF_API_KEY` or `GEMINI_API_KEY` in `html-gen/.env` or the repo-root
`.env` (`html-gen/.env` wins over the root one; shell variables override `.env`, except the two API keys: `.env` wins for those); BayLeaf is used whenever its key is set (override with `PROVIDER=gemini`). Optional:
`MODEL` / `BASE_URL` (BayLeaf, default `openrouter:moonshotai/kimi-k3.1-pro` at
`https://api.bayleaf.dev/v1`), `GEMINI_MODEL` (default `gemini-3.8-flash`), `MAX_REPAIRS`
(default 5), `LLM_TIMEOUT` (seconds for a streamed reply to finish, default 1000; timeouts are not retried, while connection errors, 429s and 5xx are retried twice), `LLM_STREAM_RETRIES` (default 3, retries a reply whose stream breaks partway; text that already arrived is kept and the model is asked to continue from there, see `continuation.js`),
`RULES=<path to rules.md>` to skip the rules step, `STYLE=<image name in styles/ | a.png,b.jpg | style.md>` to copy an image's art style (`STYLE_MODEL` overrides the model for that vision call), `CLARIFY=false` to skip the design questions,
`OPEN_GAME=false` to stop it opening the browser. The tests do not call the API.

## Pipeline

```
idea ─▶ clarifyPrompt ─▶ your answers ─▶ rulesPrompt ─▶ rules.md (+ design-notes.md) ─▶ [STYLE image ─▶ style.md] ─▶ translatePrompt (+ contract.md, style) ─▶ game.js
                                                                        │
             ┌──────────── repairPrompt ◀── validator errors ◀── validateGame
             └─▶ new game.js ─▶ validate again (up to MAX_REPAIRS times)
                                                                        │ ok
                                     outputs/<timestamp>/index.html + game.js ─▶ open in browser
```

0. **Clarify** (`clarify.js`): the LLM asks up to 5 multiple-choice design questions about the idea
   (game type, player count, theme...); the user picks an option, types their own, or presses Enter.
   The answers go into the rules prompt as `{preferences}` and are saved as `brief.md`.
1. **Rules**: the LLM designs a game from the idea as plain-English rules (no code). In the same reply, after a
   `=== DESIGN NOTES ===` line, it explains each rule: its origin (New / Adapted from X / Borrowed from X), why
   it was chosen, which rules it connects to, and the intended rule interactions. `designNotes.js` splits the
   reply: `rules.md` (sent on to the code prompts) and `design-notes.md` (saved only, for studying how the
   design was made). With `RULES=`, a `design-notes.md` next to the reused rules is copied over.
1b. **Style** (`style.js`, only with `STYLE`): a vision call turns the reference image(s) in `styles/` into a
   written style guide, saved as `style.md` in the run and cached next to the image as `styles/<name>.md`
   (keyed by an image hash; later runs reuse it). It goes into the translate and repair prompts as `{style}`. Only the
   style is copied: the game draws its own art and never loads the image.
2. **Translate**: the LLM writes `game.js` against `contract.md`, defining `window.GameEngine`
   (pure logic) and `window.GameView` (rendering and input).
3. **Validate**: `gameRunner.js` loads the game in the real shell page under jsdom, in a child
   process with a 60s timeout. Stages: `load` → `api` → `playout` (random games at min/default/max
   player counts, checking for mutation, nondeterminism, bad results, hidden-info leaks, and that `turnPhase` names a `turnPhases` id; then the tutorial script is replayed on 8 random setups and must walk player 1 through every turn part not marked `sometimes` and show each opponent move) →
   `ui` (clicks through the tutorial, then plays through the shell with the Coach on, clicks every board element, undo/restart) → `ai` (short MCTS
   searches). A pass returns playout stats (win split, avg moves, branching factor, game-tree
   complexity).
4. **Repair**: on failure, `repairFeedback` turns the result into an error message and the LLM
   rewrites the whole file. Each attempt and its report is saved.
5. **Publish**: a passing game is written as `game.js` plus a copy of `shell/index.html`, then
   opened in the default browser.

## Files

| File | Role |
| --- | --- |
| `html-gen/src/pipeline.js` | Entry point (`npm run gen`). Loads `.env`, picks the provider (BayLeaf or Gemini, both OpenAI-compatible), builds the LangChain chains (clarify, rules, style, translate, repair), runs clarify → rules → style → code → repair, streaming each reply with a progress line and a hard deadline. Creates `outputs/<timestamp>/` and saves `rules.md` before writing code, then opens the game. |
| `html-gen/src/clarify.js` | Parses the LLM's design questions (JSON) and asks them on the terminal with numbered options plus a free-text answer. |
| `html-gen/src/designNotes.js` | `splitDesignNotes` splits the rules reply at the `=== DESIGN NOTES ===` marker into the rules and the design notes (null when the model left the marker out). |
| `html-gen/src/continuation.js` | Keeps a reply that broke mid-stream: builds the "continue where you stopped" request and joins the pieces (drops a reopened code fence and repeated overlap). Used by `ask()` in `pipeline.js`. |
| `html-gen/src/style.js` | Resolves `STYLE` to files in `styles/`, builds the multimodal style-guide request (images as base64 data URLs), and formats the guide for the prompts. |
| `html-gen/styles/` | Reference images for `STYLE`, plus each image's cached style guide (`<name>.md`). |
| `html-gen/src/prompts.js` | The prompt templates: `clarifyPrompt`, `rulesPrompt`, `translatePrompt`, `repairPrompt` (the style request lives in `style.js` because it carries images). `contract.md` and the style guide are passed in as values so their `{}` aren't treated as template variables. |
| `html-gen/contract.md` | The spec the LLM codes against: the `GameEngine`/`GameView` API, `GameKit` helpers, hidden-information rules (`observe`/`determinize`), the required tutorial fields (`quickStart`, `turnPhases` + `turnPhase(state)` (the parts of a turn and which one is active), the `tutorial` step script, `describeMove`, `explainTurn`; `say`/`explainTurn` get the observed state in hidden games), and visual guidance. Edit this to change what games must provide. |
| `html-gen/src/repairLoop.js` | `extractCode` pulls code out of a fenced block. `repairUntilPlayable` runs the validate → repair loop, saves `attempt-N.js`/`.json` and `result.json`, and on success writes `game.js` + `index.html`. |
| `html-gen/src/gameRunner.js` | The headless validator (`npm run validate`). `validateGame` spawns itself with `--child`; `checkGame` does the staged checks in jsdom; `playoutStats` computes the metrics; `shellHtml` produces the page that loads a given game file. |
| `html-gen/shell/index.html` | Fixed page every game runs in (written by us, never by the LLM): layout, player chips, seats (human/random/MCTS), player-count picker, undo/restart, move log, rules panel, pass-the-device curtain, guided Tutorial (intro shows `quickStart` + the parts of a turn; then runs the game's `tutorial` script from a new game, showing a turn tracker and "what you can do now" (the part's `how` + `explainTurn`) on each learner move: during a move step only the taught move is passed to the view as legal, opponent steps wait for Next, the computer never moves on its own; then a practice turn where the learner plays one full turn with all legal moves open; the last page recaps goal + turn parts. Games without a script get a generic 3-turn MCTS walkthrough) and a Coach toggle (`explainTurn` text plus an MCTS Hint with Play it), `window.GameKit` (seeded RNG, dice, 52-card deck SVGs), and the information-set MCTS opponent. Exposes `window.GameShell` for tests and the validator. |
| `html-gen/test/fixtures/` | Known-good games used by the tests: `connect-four.js` (perfect information) and `crazy-eights.js` (hidden information, 2–4 players). |
| `html-gen/examples/` | Any `.js` here is sent to the LLM (rules, translate and repair prompts) as a reference game. Currently empty; copy a fixture in to give the LLM one. |
| `html-gen/outputs/` | Generated runs (gitignored): `brief.md`, `rules.md`, `design-notes.md`, `style.md`, `attempt-N.js/.json`, `result.json`, and on success `game.js` + `index.html`. |
| `html-gen/test/*.test.js` | `node:test` suites: validator stages and stats, repair loop behavior, prompt formatting, shell + MCTS behavior. |

## Conventions

- Keep the split: the shell owns all chrome and AI; `game.js` only defines `GameEngine` and
  `GameView`. Features every game should get belong in `shell/index.html` (and `contract.md` if
  games must cooperate), not in prompts.
- `GameEngine` must stay pure and deterministic (state in, new state out; randomness only via
  the seed in state through `GameKit`). The validator and MCTS depend on this.
- Validator error messages are read by the LLM, so write them as concrete instructions for
  fixing the game.
- When changing the contract, update `contract.md`, the checks in `gameRunner.js`, the
  fixtures, and the tests together.
