# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

A generator that turns a one-line game idea into a playable browser game. An LLM writes the
rules and then the JavaScript, a headless validator plays the game and reports errors, and
the LLM repairs the code until it passes. The result is a folder holding `index.html` +
`game.js` that runs from disk without a server.

The project used to generate Ludii `.lud` files. Commit `ca89245` replaced that with the
JavaScript generator, so the root `outputs/` (old Ludii runs, `UNO.lud`) and the Ludii stats in
`TuesdayPresentation.md` are from the previous pipeline.

## Commands

All code lives in `html-gen/` (Node, ES modules, no build step).

```sh
cd html-gen
npm install
npm run gen -- "a two-player capture game on a hexagonal board"   # generate a game
npm run validate -- fixtures/connect-four.js                       # validate, 20 playouts
npm run validate -- outputs/<run>/game.js 200 1000                 # playouts, move limit
npm test                                                           # node --test, all *.test.js
node --test gameRunner.test.js                                     # one test file
```

`npm run gen` needs `BAYLEAF_API_KEY` or `GEMINI_API_KEY` in `html-gen/.env` or the repo-root
`.env`; BayLeaf is used whenever its key is set (override with `PROVIDER=gemini`). Optional:
`MODEL` / `BASE_URL` (BayLeaf, default `openrouter:moonshotai/kimi-k3.1-pro` at
`https://api.bayleaf.dev/v1`), `GEMINI_MODEL` (default `gemini-3.8-flash`), `MAX_REPAIRS`
(default 5), `LLM_TIMEOUT` (seconds for a streamed reply to finish, default 600; timeouts are not retried),
`RULES=<path to rules.md>` to skip the rules step,
`OPEN_GAME=false` to stop it opening the browser. The tests do not call the API.

## Pipeline

```
idea ─▶ rulesPrompt ─▶ rules.md ─▶ translatePrompt (+ contract.md) ─▶ game.js
                                                                        │
             ┌──────────── repairPrompt ◀── validator errors ◀── validateGame
             └─▶ new game.js ─▶ validate again (up to MAX_REPAIRS times)
                                                                        │ ok
                                     outputs/<timestamp>/index.html + game.js ─▶ open in browser
```

1. **Rules**: the LLM designs a game from the idea as plain-English rules (no code).
2. **Translate**: the LLM writes `game.js` against `contract.md`, defining `window.GameEngine`
   (pure logic) and `window.GameView` (rendering and input).
3. **Validate**: `gameRunner.js` loads the game in the real shell page under jsdom, in a child
   process with a 60s timeout. Stages: `load` → `api` → `playout` (random games at min/default/max
   player counts, checking for mutation, nondeterminism, bad results, and hidden-info leaks) →
   `ui` (plays through the shell, clicks every board element, undo/restart) → `ai` (short MCTS
   searches). A pass returns playout stats (win split, avg moves, branching factor, game-tree
   complexity).
4. **Repair**: on failure, `repairFeedback` turns the result into an error message and the LLM
   rewrites the whole file. Each attempt and its report is saved.
5. **Publish**: a passing game is written as `game.js` plus a copy of `shell/index.html`, then
   opened in the default browser.

## Files

| File | Role |
| --- | --- |
| `html-gen/pipeline.js` | Entry point (`npm run gen`). Loads `.env`, picks the provider (BayLeaf or Gemini, both OpenAI-compatible), builds the three LangChain chains, runs rules → code → repair loop, streaming each reply with a progress line and a hard deadline. Creates `outputs/<timestamp>/` and saves `rules.md` before writing code, then opens the game. |
| `html-gen/prompts.js` | The three prompt templates: `rulesPrompt`, `translatePrompt`, `repairPrompt`. `contract.md` is passed in as a value so its `{}` aren't treated as template variables. |
| `html-gen/contract.md` | The spec the LLM codes against: the `GameEngine`/`GameView` API, `GameKit` helpers, hidden-information rules (`observe`/`determinize`), and visual guidance. Edit this to change what games must provide. |
| `html-gen/repairLoop.js` | `extractCode` pulls code out of a fenced block. `repairUntilPlayable` runs the validate → repair loop, saves `attempt-N.js`/`.json` and `result.json`, and on success writes `game.js` + `index.html`. |
| `html-gen/gameRunner.js` | The headless validator (`npm run validate`). `validateGame` spawns itself with `--child`; `checkGame` does the staged checks in jsdom; `playoutStats` computes the metrics; `shellHtml` produces the page that loads a given game file. |
| `html-gen/shell/index.html` | Fixed page every game runs in (written by us, never by the LLM): layout, player chips, seats (human/random/MCTS), player-count picker, undo/restart, move log, rules panel, pass-the-device curtain, `window.GameKit` (seeded RNG, dice, 52-card deck SVGs), and the information-set MCTS opponent. Exposes `window.GameShell` for tests and the validator. |
| `html-gen/fixtures/` | Known-good games used by the tests: `connect-four.js` (perfect information) and `crazy-eights.js` (hidden information, 2–4 players). |
| `html-gen/examples/` | Any `.js` here is sent to the LLM as a reference game. Currently empty. |
| `html-gen/outputs/` | Generated runs (gitignored): `rules.md`, `attempt-N.js/.json`, `result.json`, and on success `game.js` + `index.html`. |
| `html-gen/*.test.js` | `node:test` suites: validator stages and stats, repair loop behavior, prompt formatting, shell + MCTS behavior. |
| `TuesdayPresentation.md` | Meeting notes: task list and Ludii-era benchmark stats (Chess, Connect 4, Reversi). |

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
