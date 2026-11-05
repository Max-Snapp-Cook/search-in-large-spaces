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

Settings are read from `html-gen/.env` first, then the repo-root `.env`. Set
`BAYLEAF_API_KEY` or `GEMINI_API_KEY`; BayLeaf is used whenever its key is set. Optional settings:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PROVIDER` | `bayleaf` if its key is set, else `gemini` | Which API writes the rules, code, and repairs |
| `MODEL` | `openrouter:moonshotai/kimi-k3.1-pro` | BayLeaf model |
| `BASE_URL` | `https://api.bayleaf.dev/v1` | BayLeaf endpoint |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Gemini model |
| `MAX_REPAIRS` | `5` | Repair attempts after the first; `0` validates once |
| `LLM_TIMEOUT` | `600` | Seconds each model reply may take to finish streaming; a reply that runs out of time is not retried (connection errors, 429s and 5xx are retried twice) |
| `RULES` | — | Path to a `rules.md` from an earlier run; skips the rules step and writes code from it |
| `OPEN_GAME` | on | Set to `false` to stop the finished game from opening in your browser |

Each run creates `outputs/<timestamp>/` with `rules.md`, numbered `attempt-N.js` files and
their `attempt-N.json` validation reports, plus `result.json`. When a game passes,
the playable site is written next to them as `index.html` + `game.js` and opens automatically.

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

### Examples

`examples/` is empty for now. Any `.js` file placed there (in the `game.js` format) is sent
to the LLM as a reference game. `fixtures/connect-four.js` is a known-good game used by the
tests. Copy it into `examples/` if you want the LLM to see one.

## Validate a game

```powershell
npm run validate -- fixtures/connect-four.js            # 20 random playouts
npm run validate -- outputs/<run>/game.js 200 1000      # playouts, move limit per playout
```

`gameRunner.js` loads `game.js` inside the real shell page in
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
import { validateGame, repairFeedback } from "./gameRunner.js";

const result = await validateGame("outputs/my-run/game.js", { playouts: 50, maxMoves: 1000 });
const feedback = repairFeedback(result); // null when ok or not fixable by the LLM
```

jsdom has no real layout or canvas drawing, so validation proves that a game runs, not that
it looks right. Open `index.html` to check how it looks.

## Tests

```powershell
npm test
```
