# html-gen

Generates board games as small websites. Every run produces a folder with `index.html` and
`game.js`. Double-click `index.html` and the game opens in your browser; no server is needed.

The flow is idea → rules → code → validate → repair, with an LLM (BayLeaf or Gemini) writing
the rules and the JavaScript, and a headless validator feeding errors back until the game works.

## Run the pipeline

```powershell
cd html-gen
npm install
npm run gen -- "a two-player capture game on a hexagonal board"
```

Settings are read from `html-gen/.env` first, then the repo-root `.env`. Settings set in your shell
(e.g. `MODEL=x npm run gen`) override `.env`, except API keys: when `.env` has a key, it always wins, so
switching keys only takes editing `.env`. Each run prints which key it uses (last 4 characters) and where it
came from. Set
`BAYLEAF_API_KEY` or `GEMINI_API_KEY`; BayLeaf is used whenever its key is set. Optional settings:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PROVIDER` | `bayleaf` if its key is set, else `gemini` | Which API writes the rules, code, and repairs |
| `MODEL` | `openrouter:moonshotai/kimi-k3.1-pro` | BayLeaf model |
| `BASE_URL` | `https://api.bayleaf.dev/v1` | BayLeaf endpoint |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Gemini model |
| `MAX_REPAIRS` | `5` | Repair attempts after the first; `0` validates once |
| `LLM_TIMEOUT` | `1000` | Seconds each model reply may take to finish streaming; a reply that runs out of time is not retried (connection errors, 429s and 5xx are retried twice) |
| `CLARIFY` | on | Before writing rules, the LLM asks a few multiple-choice design questions (game type, players, theme...) on the terminal; pick a number, type your own answer, or press Enter to let it decide. Set to `false` to skip. Skipped automatically when not run from a terminal or when `RULES` is set |
| `LLM_STREAM_RETRIES` | `3` | Times a reply that breaks mid-stream (provider dropped, 5xx, connection lost) is retried, with a fresh `LLM_TIMEOUT` each time. Text that already arrived is kept, and the retry asks the model to continue from where it stopped instead of starting over |
| `RULES` | — | Path to a `rules.md` from an earlier run; skips the rules step and writes code from it |
| `STYLE` | — | Art style to copy: the name of an image in `styles/` (`castle` or `castle.png`), several separated by commas, or a `style.md` from an earlier run. See "Art style" below |
| `STYLE_MODEL` | same as the main model | Model for describing the style images (must accept images); same provider and key |
| `OPEN_GAME` | on | Set to `false` to stop the finished game from opening in your browser |

Each run creates `outputs/<timestamp>/` with `brief.md`, `rules.md`, `design-notes.md` (why the model chose each rule, whether
it is new or adapted from an existing game, and which rules are meant to interact), `style.md` (when `STYLE` is set), numbered `attempt-N.js` files and
their `attempt-N.json` validation reports, plus `result.json`. When a game passes,
the playable site is written next to them as `index.html` + `game.js` and opens automatically.

## Art style

Put a reference image (`.png`, `.jpg`, `.webp`, `.gif`) in `styles/` and name it in `STYLE`:

```sh
STYLE=castle npm run gen -- "a two-player capture game on a hexagonal board"
```

The game copies the image's *style*, not the image itself. After the rules are written, a vision model
describes the image as a style guide (palette with hex codes, shapes and line work, shading, typography,
mood) and saves it as `style.md` in the run folder. The guide is also saved next to the image (`styles/castle.md`),
and later runs with that image reuse it instead of asking the model again. Edit that file to tweak the style, or
delete it to have the image described again (replacing the image also triggers a fresh description). The code and repair prompts then follow that guide,
and the game draws its own board and pieces in SVG/CSS. No image files end up in the game. To keep the
same look without describing the image again, rerun with `STYLE=outputs/<run>/style.md`. You can also
edit that file by hand to adjust the style.

If your model cannot read images, set `STYLE_MODEL` to one that can, or use `PROVIDER=gemini`.

## How a game is put together

| File | Written by | Job |
| --- | --- | --- |
| `shell/index.html` | us (fixed) | Page layout, title, player chips, turn/result status, Undo/Restart, rules panel, computer opponents |
| `game.js` | the LLM | `window.GameEngine` (rules) + `window.GameView` (drawing the board and taking input) |

Since the LLM only writes the rules and the board, every game gets the same polished frame,
and the LLM has room to make the board itself look good (SVG, canvas, animations).
The full contract the LLM codes against is in [`contract.md`](contract.md). Edit that file to
change what games must provide. In short:

```js
window.GameEngine = {
  name, players, playerNames, playerColors, rules,
  initialState(), currentPlayer(state), legalMoves(state),
  applyMove(state, move),   // returns a NEW state
  result(state),            // null, { winner: n }, or { winner: null } for a draw
};
window.GameView = {
  mount(container, { play, engine, names, colors }) {
    return { update(state, { legalMoves, canMove, player, lastMove, result }) {} };
  },
};
```

### Computer opponents

The engine is pure and game-agnostic, so the shell can provide opponents for **any**
generated game:

- **vs Computer (random)**: plays a random legal move.
- **vs Computer (strong)**: Monte Carlo tree search (UCT) with about 0.9s per move.
- **Computer vs computer**: watch two MCTS players.

`window.GameShell.mctsMove(state, ms)` is also available in the browser console, and it's a
starting point for AI-based evaluation of generated games.

### Tutorial

Every game has a **Tutorial** button and a **Coach** toggle in the header, so nobody has to read the rules first.

- **Tutorial** starts a new game against the computer and walks you through it in a box above the board:
  first the goal (the game's `quickStart`) and how a turn works (its `turnPhases`, e.g. Roll › Buy › End turn),
  then a full round one step at a time. On each of your moves the box highlights which part of the turn you're
  in, lists **what you can do now** (that part's how-to plus `explainTurn` for the current situation), and then
  suggests a move and says why. Only the suggested move is clickable (it's the only legal move the board is
  given), and **Do it for me** makes it. Opponent moves wait for **Next**, and the box recaps what they did.
  After the guided steps you play **one whole turn on your own** with every legal move open. The last page
  recaps the goal and each part of a turn; **Keep playing** continues the game against the computer, or
  **New game** starts over. The steps come from the game's `tutorial` script (see `contract.md`). Games made
  before scripts existed get an automatic version: the computer picks a good move for each of your first 3
  turns and the move log text describes it. Games made before `turnPhases` existed skip the turn tracker.
- **Coach** (off by default, remembered per browser) shows a box during normal play that explains the current
  turn (`explainTurn`), what the opponent just did, and a **Hint** button: the strong computer suggests a move
  and **Play it** makes it.

### Examples

`examples/` is empty for now. Any `.js` file placed there (in the `game.js` format) is sent
to the LLM as a reference game. `test/fixtures/connect-four.js` is a known-good game used by the
tests. Copy it into `examples/` if you want the LLM to see one.

## Validate a game

```powershell
npm run validate -- test/fixtures/connect-four.js       # 20 random playouts
npm run validate -- outputs/<run>/game.js 200 1000      # playouts, move limit per playout
```

`src/gameRunner.js` loads `game.js` inside the real shell page in
[jsdom](https://github.com/jsdom/jsdom), in a child process with a 60s timeout:

1. **load**: no syntax errors or uncaught exceptions, and the shell starts.
2. **api**: `GameEngine` and `GameView` match the contract.
3. **playout**: random games check the engine on every move: valid current player,
   non-empty legal moves while running, no state mutation, and a valid result.
4. **ui**: plays three games through the shell, so `GameView.update` renders many positions,
   with undo/restart and clicks on every board element at several points.
5. **timeout**: the game hung (usually an infinite loop).

Failures in these stages go back to the LLM for repair, with stack traces pointing at lines
in `game.js`. A passing result includes stats for comparing games:

```json
{ "playouts": 200, "completed": 200, "wins": { "1": 119, "2": 81 }, "draws": 0,
  "moveLimitReached": 0, "avgMoves": 20.8, "avgBranchingPerTrial": 6.8,
  "avgBranchingPerState": 6.75, "gameTreeComplexityLog10": 17.3 }
```

From JavaScript:

```js
import { validateGame, repairFeedback } from "./src/gameRunner.js";

const result = await validateGame("outputs/my-run/game.js", { playouts: 50, maxMoves: 1000 });
const feedback = repairFeedback(result); // null when ok or not fixable by the LLM
```

jsdom has no real layout or canvas drawing, so validation proves that a game runs, not that
it looks right. Open `index.html` to check how it looks.

## Tests

```powershell
npm test
```
