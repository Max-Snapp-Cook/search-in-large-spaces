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
| `LLM_TIMEOUT` | `1200` | Seconds each rules, code, or repair reply may take to finish streaming; a reply that runs out of time is not retried (connection errors, 429s and 5xx are retried twice) |
| `RULES` | — | Path to a `rules.md` from an earlier run; skips the rules step and writes code from it |
| `OPEN_GAME` | on | Set to `false` to stop the finished game from opening in your browser |

Games are organized by their title (from the rules heading), with short numbered versions:

```text
outputs/gyre/
  project.json
  versions/
    v001/                 # game.js, index.html, rules.md, validation attempts
    v002/
  playtests/
    v001/run-001/          # report.md, replay.html, transcript, metadata
    v002/run-001/
  plans/
    plan-001/             # plan.md, plan.json, inputs, responses, improvement.json
```

Repeated generation with the same title adds another version. Names are made safe for file
paths; distinct titles that normalize to the same folder name receive a numeric suffix.
Numbered folders are reserved without overwriting prior runs. Timestamps remain in metadata.
Each version keeps `rules.md`, `attempt-N.js`, `attempt-N.json`, `result.json`, and `version.json`.
After validation passes, it also contains `game.js` and `index.html` and opens automatically.
Failed/interrupted versions stay available for inspection but are skipped by `latest`.

Commands accept a game name or a full path. Named games default to the latest validated version:

```powershell
npm run playtest -- gyre --planning on --endgame-awareness on
npm run playtest -- gyre --version v001
npm run improve -- gyre
npm run improve -- gyre --version v001 --plan-only
npm run improve -- gyre --from-plan latest
npm run improve -- gyre --from-plan plan-001
```

To import old timestamp folders, including nested improvements, plans, and ordinary playtests:

```powershell
npm run organize -- --all
# Or import one legacy game's tree:
npm run organize -- outputs/<old-game-run>
```

Import copies files and records the mapping in `imports.json`; originals and their historical
links remain intact. Repeating it does not duplicate imported versions/plans/matches and can
pick up new matches or improvements. Original benchmark folders remain in the legacy archive.
Old direct game paths still work. Their playtests use `run-001` folders and their improvements
use `plan-001` folders; use the imported game name for the new flat project layout.

## Improve a game from playtest reports

From `html-gen`, run:

```powershell
npm run improve -- gyre
```

The command reads the existing `game.js`, `rules.md`, contract, and all usable
`playtests/<version>/run-*/report.md` files for the selected game version. It asks the generation model to diagnose
the evidence and write a concrete plan, then implements that plan and runs the existing
engine/UI/agent-interface validation and repair loop. The original game and reports stay
intact. The plan is saved in `plans/plan-001/` and the revised game gets a new `versions/vNNN/`
folder in the same project. Improving an improvement never adds another level of nesting.

Choose reports explicitly by repeating `--report`, or preview just the plan:

```powershell
npm run improve -- gyre --report outputs/gyre/playtests/v001/run-001/report.md --version v001
npm run improve -- gyre --report <first-match-directory> --report <second-match-directory>
npm run improve -- gyre --plan-only
```

Apply an already generated plan without paying for another planning request:

```powershell
npm run improve -- gyre --from-plan plan-001
# A full saved-plan path also works:
npm run improve -- --from-plan outputs/gyre/plans/plan-001/plan.json
```

You can also pass the plan's directory. This uses its saved source code, rules, and report
snapshots and creates a new plan-run record plus a new version. The plan and previous attempts stay
intact. `plan.json` is the machine-readable plan; edits to the display-only `plan.md` are not
applied. With a full plan path, an optional game path checks that its code/rules still match the
saved source. Short plan selection (`gyre --from-plan plan-001`) uses the saved source even if
a newer version exists; add `--version` to explicitly check a selected source version.
`--from-plan` cannot be combined with `--report` or `--plan-only`.

Each proposed change cites a report and evidence, names implementation work, declares any
rule changes, and describes a verification scenario. Unsupported suggestions go into the
plan's deferred section. The model is instructed to check player claims against source code,
separate agent mistakes and request failures from game bugs, and avoid treating an interrupted
game as a draw or proven balance problem. If evidence supports no changes, the command saves
the plan and stops without generating code. These judgments remain model-generated.

Reports with a conflicting source hash or archived `game.js` are skipped during discovery
and rejected when explicitly selected. Identical report content is deduplicated. Standalone
reports without provenance are accepted but marked unverified. Missing or empty reports are
not sent to the model. Large inputs fail with an actionable size error rather than silently
dropping reports, rules, or source code.

Each plan-run folder contains:

- `inputs/`: snapshots of original code, rules, and selected reports, numbered by report ID.
- `plan.json` and `plan.md`: proposed changes, supporting evidence, and deferred issues.
- `rules.md`: complete resulting rules; unchanged unless the plan explicitly changes rules.
- `NN-<stage>.response.txt`: raw model responses, streamed to disk so partial work survives errors/timeouts.
- `requests.jsonl`: per-request duration, reported token usage when available, and errors.
- `improvement.json`: source/report hashes, selected model, run status, and final validation result.

The linked version folder contains `attempt-N.js`, `attempt-N.json`, and `result.json` for
implementation/repair attempts, plus `game.js` and `index.html` only after validation passes.
Plan-only/no-change runs do not allocate a new version. `improvement.json` records the version
directory and `version.json` links back to the plan and parent version.

It uses the generation `PROVIDER`, `MODEL`/`GEMINI_MODEL`, credentials, and endpoint settings,
independently of the playtest model. `--provider` and `--model` override those defaults.
`--timeout` defaults to `LLM_TIMEOUT` or 1,200 seconds per model request. `--max-repairs`
defaults to `MAX_REPAIRS` or 5. `--out` chooses a different parent for plan-run artifacts;
named-project versions still stay under that project's `versions/` folder.
`--max-prompt-chars` defaults to 500,000, counting the system instructions and serialized input.
Normal runs make one planning request, one implementation request, and a request per needed
repair. `--plan-only` makes only the planning request; rerunning without that flag creates a
fresh plan and revision; use `--from-plan` to reuse the saved plan instead. `Ctrl+C` aborts an active model request and preserves its partial text.

Validation checks that the revised game runs and follows the interface contract; it does
not prove that the proposed verification scenarios pass or that balance/enjoyment improved.
No new LLM playtest runs automatically. Evaluate the revision with:

```powershell
npm run playtest -- gyre --planning on --endgame-awareness on
```

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

## LLM playtests of an existing game

Run from `html-gen`. Generate a game with the current contract, then supply its directory,
`game.js`, or `index.html`:

```powershell
npm run gen -- "your game idea"
npm run playtest -- outputs/<new-game-run>
```

Games must implement `agentContext()`, `agentObservation(observed, player)`, and
`describeAction(observed, move, player)` from [contract.md](contract.md). Old outputs such as
Bramblebrook are not adapted: the command asks you to generate a new game before making
model calls. The Connect Four fixture includes the new interface for testing.

Every seat gets an independent player agent. On each decision it receives the rules and public
map/definitions, one readable current observation, compact factual history, and legal actions
with readable labels and IDs plus counts by action category. Earlier feelings and explanations
are excluded from move requests to avoid reinforcing mistaken beliefs. Raw state encodings,
raw move payloads, and old board snapshots are not sent to the model. It returns a short
feeling, a move explanation, and a move ID.
The engine selects the active player, so consecutive decisions, interruptions, eliminated
players, draws, and shared wins work without assuming round-robin turns. Every player,
including eliminated players, is asked for a final reflection.

By default, the command uses BayLeaf when `BAYLEAF_API_KEY` is set, otherwise Gemini. An
explicit `PLAYTEST_PROVIDER` or existing `PROVIDER` setting takes precedence. It uses
`openrouter:moonshotai/kimi-k3.1-pro` on BayLeaf or `gemini-3.5-flash-lite` on Gemini.
Kimi uses the benchmark's low reasoning effort and 8,192-token output ceilings for both
moves and reflections. These are maximums, not required response lengths; they leave room
for reasoning before the short JSON reply. Reasoning settings are recorded in match metadata.
The generation model (`MODEL` / `GEMINI_MODEL`) is independent of the player model.

```powershell
npm run playtest -- petalpoint --players 3 --provider bayleaf
npm run playtest -- gyre --version v001 --provider gemini --model gemini-3.5-flash-lite
npm run playtest -- fixtures/connect-four.js --max-moves 60 --timeout 30 --retries 1
npm run playtest -- --help
```

Credentials are read from `html-gen/.env`, falling back to the repository `.env`. No model
calls are made by `--help`. Environment overrides are `PLAYTEST_PROVIDER`, `PLAYTEST_MODEL`,
and `PLAYTEST_BASE_URL`; BayLeaf also uses the existing `BASE_URL` setting. Secrets are not
written to reports or sent to generated JavaScript.

| Option | Default | Meaning |
| --- | --- | --- |
| `--players` | engine default | A count within the game's supported range |
| `--rules` | adjacent `rules.md`, then engine rules | Optional replacement rules file |
| `--version` | latest validated | Source version for a named game, e.g. `v001` |
| `--out` | `<project>/playtests/<version>` | Parent folder for a numbered `run-001` match (legacy paths use `<game-directory>/playtests`) |
| `--max-moves` | 500 | Maximum accepted decisions, not full player rounds |
| `--max-minutes` | 30 | Gameplay deadline; reflection requests happen afterward |
| `--timeout` | 60 | Seconds per model request, including receipt of its full response |
| `--retries` | 2 | Additional attempts per move or reflection |
| `--planning` | off | `on` or `off`: private, revisable plan memory |
| `--endgame-awareness` | off | `on` or `off`: explicit ending, scoring, and time guidance |
| `--move-tokens` | 8192 for Kimi; 350 otherwise | Maximum output tokens per move request |
| `--reflection-tokens` | 8192 for Kimi; 1200 otherwise | Maximum output tokens per reflection request |
| `--max-prompt-chars` | 100000 | Reject oversized input rather than truncate the current state or move list |

Enable either feature independently, or both:

```powershell
npm run playtest -- gyre --planning on --endgame-awareness on
```

Both default to `off` to preserve existing runs as a comparison baseline. Pass `off` to
disable either. Planning returns a short goal, one to three future steps, conditions for
reconsidering, and a time horizon in the normal move response. The latest accepted plan
is passed only to that player on their next decision (including consecutive actions).
Agents must check it against current facts and may revise it or return `plan: null` to
abandon it. Old plans never become factual history. Reports and replays display the plans
as unverified intentions; metadata records both toggles. Final reflections receive the
player's last plan as an intention, not proof that it happened.

Endgame guidance emphasizes ending triggers, scoring, tiebreakers, and whether a payoff
can occur in time. Newly generated games must supply structured `agentObservation.endgame`
facts, including explicit uncertainty when a countdown is unknown. Existing games still
work: guidance uses their rules and current observations without guessing missing counts.
Turning guidance off removes the extra prompt emphasis, not the game's rules or native
observation fields. Runner time/move limits are never presented as game-ending rules.

Neither feature adds a separate model request. Plans add input/output tokens. For other models
with a 350-token default, consider `--move-tokens 600`; Kimi already has more room. Malformed plans can trigger
the existing bounded format retries; no additional LLM validation is performed.

The output directory contains:

- `report.md`: calculated personal/match decision counts, action counts, outcomes, game metrics,
  request diagnostics (including recovered errors), subjective reflections, and selected action
  labels displayed before unverified explanations.
- `transcript.jsonl`: versioned, sequential events, including readable observations, action labels,
  per-viewer factual changes, retries, and latency. Appended as the game runs.
  Failed requests include their decision/phase, request ID, specific error code, available usage,
  provider finish reason, and rejected response text when a response arrived. These diagnostics
  stay in organizer artifacts and are not added to opponents' prompts.
- `replay.json`: the full initial state, applied moves, latest state, and outcome.
- `replay.html`: an offline viewer generated when the command finishes, including partial runs
  with a saved initial state. Open it in a browser to watch the recorded game.
- `metadata.json`: model, limits, source hash, completion status, calculated per-player statistics,
  and token usage when supplied by the provider.
- `agent-context.json`: the static public context supplied to player agents.
- `game.js` and `rules.md`: copies of the inputs used for this match.

The report and replay checkpoint are refreshed after every move and reflection. `Ctrl+C`
stops requests and writes partial results. Invalid responses get bounded retries; exhausted
retries, engine errors, or gameplay limits mark the run **incomplete**. No random moves are
substituted and a limit is never reported as a draw. Reflections are attempted after an
incomplete game unless interrupted. If an individual reflection fails, the remaining
players are still asked and the feedback status is `partial`. Exit code 0 requires both
a completed game and all player reflections; otherwise it is 1.

`complete` describes the game outcome, not an error-free run. The report's Run diagnostics
section lists failed attempts, whether each recovered, affected decisions, retry requests,
and reported input/output tokens for failed attempts. These tokens are already included in
the total usage. Missing usage or finish reasons are shown as unknown, never guessed.
Format errors distinguish missing fields, wrong types, blank strings, excessive lengths,
invalid JSON, and IDs that are not in the legal move list.

You can rebuild a finished run's report from its saved transcript without any model calls:

```powershell
npm run playtest:report -- outputs/gyre/playtests/v001/run-001
```

This preserves the first report as `report.original.md` and replaces `report.md`; it does not
change metadata, moves, reflections, or the transcript. Older logs can recover error counts,
affected decisions, and recorded usage, but response bodies and finish reasons that were never
saved cannot be reconstructed. The report explicitly identifies those missing diagnostics.

There is one model request per normal decision, plus a final reflection per player. There
are no LLM reviewers or semantic explanation checks. Local JSON/field checks and move-ID
membership checks remain; only malformed replies, illegal IDs, or request failures cause retries.
An explanation can disagree with a selected action without triggering extra model calls.
Treat the engine-derived action and recorded facts as authoritative; subjective reflections
can still be inaccurate. Per-player game metrics come from `agentObservation(...).metrics`;
the runner never guesses missing game-specific statistics or scoring breakdowns.

Token output caps are per request, not a total billing cap. Usage totals include failed-format
responses when available; requests without usage metadata and failed network requests can
make provider billing exceed the recorded total. Retries also consume calls. Gameplay time
limits reserve a separate opportunity for reflections, which may take up to
`players × (retries + 1) × timeout` additional seconds.

Hidden-information games must implement `observe` correctly; public move descriptions must
obey the existing contract. RNG fields named `seed`, `rngSeed`, or `randomSeed` (also snake_case)
are removed from agent-visible observations; games with other RNG fields must mask them in `observe`. Other
players never receive an agent's private commentary, private action label, or raw move.
The readable interface receives only the masked observation, not the full state.
Factual history contains public events, the player's own selected actions, and compact readable
field changes (up to 1,200 characters of changes per event), never previous full observations.
It keeps up to 3,000 characters for decisions and 8,000 for reflections. Subjective commentary
is supplied only for final reflections, with a separate 4,000-character budget; it remains
fully recorded in transcripts, reports, and replay viewers. Omitted changes/events are explicitly counted.
Move prompts end with the current observation, available action counts, and legal choices.
The listed moves are executable now; earlier turn restrictions do not override that list.
Calculated decision/action counts cover the entire match even when history is shortened;
current observations and facts take precedence over earlier opinions. Rules and static public
context form a stable input prefix but are still included in each stateless API request;
provider caching and billing are not assumed. Long matches have imperfect agent recall,
while the on-disk transcript retains all commentary. The report, transcript,
and full-state replay are organizer artifacts and can contain private information.

The command executes local generated JavaScript with synchronous call timeouts, using the
shell's GameKit without starting the UI or built-in computer opponents. As with the existing
validator, this is not a security sandbox for hostile code. Use the validation command to
check a game's UI and broader contract before playtesting it. The playtester also checks
engine return values, input mutation, deterministic transitions, and legal move selection.

This command evaluates game decisions and simulated player experiences. The replay viewer
displays recorded decisions after the run; the agents do not evaluate the visual interface.

### Watch a recorded playtest

Open `replay.html` in the match directory. For an older match, or to refresh its viewer:

```powershell
npm run replay -- outputs/gyre/playtests/v001/run-001
# Passing the match's replay.json path also works.
```

Share `replay.html` alone. It embeds the game code, replay data, commentary, and saved report;
no surrounding files, server, API key, or model requests are needed for playback. Older viewers
must be rebuilt with the command above to become standalone. Keep the original match files
if you want to rebuild the viewer later.
The viewer renders the original game's board from the recorded initial state and moves,
with play/pause, speed controls, stepping, a seek slider, and a clickable move timeline.
Use the before/after checkbox to inspect the position an agent was deciding from alongside
its selected action, feeling, explanation, and recorded request errors. Final reflections
appear at the end. Incomplete runs stop at the last saved move without inventing a winner.

The default spectator perspective shows all information. Player perspectives use the game's
`observe` function for hidden information and hide other agents' private commentary.
These are display filters, not access controls: the file still contains the full replay and
all commentary, so it remains an organizer artifact. Reconstruction errors are shown instead
of silently displaying a different game.

## Compare player models on saved positions

`modelBenchmark.js` reconstructs selected decisions from archived matches and gives each
configured candidate the same production move prompt and factual history:

```powershell
node modelBenchmark.js benchmarks/cindertrail-models.json
node modelBenchmarkReport.js outputs/<game-run>/benchmarks/<comparison>
```

The configuration names source matches/decisions, model variants, reasoning settings, output
limits, and the output directory. These commands make model requests only when running the
benchmark; rebuilding the report is offline. Re-running the same benchmark resumes completed
attempts and refuses changed cases or configuration in the same output directory.

`cases.json` saves exact prompts and engine-derived outcomes; those outcomes are never sent
to the models. `attempts.jsonl` saves every visible response, request duration, provider token
usage (including reported reasoning/cache details), and failures. `timings.csv`, `summary.json`,
and `report.md` summarize results. Unknown usage remains unknown, and failed-attempt usage is
included in totals. Requests run sequentially with rotating model order. Duration includes
network and provider queue time; it is not time to first token. Format acceptance is not a
judgment of strategic or factual correctness. Optional `review.json` supplies an offline,
explicitly labeled qualitative assessment for the report.

For a full-game follow-up with one configured variant and the first source match's saved setup:

```powershell
node modelBenchmarkGame.js benchmarks/cindertrail-models.json <variant-id>
```

This writes a fresh match under the comparison's `full-games` directory, including the normal
report/replay plus per-request raw usage and duration in `requests.jsonl`. It uses the larger
retry output limit for all full-game requests. It does not change the normal playtest defaults.

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

The generation pipeline sets `requireAgents: true` in validation: missing agent methods enter
the existing repair loop. Local checks exercise descriptions for every player, sampled legal
actions, and terminal states, checking shape, identity, determinism, and input mutation.
Descriptions receive masked observations with RNG seeds removed. These checks do not prove
that a generated description is semantically complete or accurate. Standalone validation
still accepts legacy games for UI/engine checking, but checks the agent interface whenever
any of its methods are present. The LLM playtest command always requires the full interface.

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
