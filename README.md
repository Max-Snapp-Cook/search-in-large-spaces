# Search in Large Spaces

Generate distinctive, self-contained HTML/JavaScript platformers with Codex using your ChatGPT sign-in. The backend interviews the user when necessary, compares design alternatives, writes an implementation contract, tests actual behavior in Chromium, and repairs deviations from the requested experience.

## Setup

Use Node.js 22 or newer:

```sh
npm ci
npm run browser:install
npm run login
npm run login:status
```

Choose ChatGPT sign-in. The official Codex SDK uses the saved Codex login and your plan's Codex allowance. No API key is needed. See [OpenAI authentication guidance](https://learn.chatgpt.com/docs/auth) and the [Codex SDK documentation](https://learn.chatgpt.com/docs/codex-sdk).

Optional `.env` settings are shown in `.env.example`: `MAX_REPAIRS` defaults to 15 (16 validation attempts including the initial version), `GENERATION_TIMEOUT_MS` defaults to 1800000 (30 minutes) per model request; set it to 0 to disable the local deadline, and `CODEX_MODEL` optionally overrides your Codex default. The CLI prints an elapsed-time heartbeat every 30 seconds while a model request is running. Local timeouts, cancellation, authentication failures and explicit usage/rate-limit errors have distinct messages. A local abort does not by itself indicate an exhausted plan. Increase the timeout for longer implementations. Each stage and repair makes additional model requests; this workflow prioritizes quality over request count or latency.

## Generate a game

```powershell
npm run gen -- "A precision platformer with wall jumps and a rechargeable air dash. No combat. Short rooms with instant retries."
```

In an interactive terminal, the model asks focused questions if important design choices are unclear. Enter an option number or a free-text answer. You can explicitly delegate a choice, or enter `:pause` to return later. Answers already entered in the current batch are saved in `answers.draft.json`; completed batches are saved in `session.json`.

Questions cover decisions that change implementation: movement feel and abilities, combat and opponents, world structure, failure/recovery, progression and objectives. They are generated from the actual brief, not a fixed questionnaire. Mechanically detailed requests can proceed without questions; themes alone usually need clarification. Answers become part of the authoritative brief. Already answered questions cannot be repeated under the same ID, and previously extracted requirements cannot silently disappear in later interview rounds.

## Questions as output and resuming

For scripts, IDE tasks or when you want to answer outside the terminal:

```powershell
npm run gen -- "A platformer about a flooded clockwork city" --non-interactive
```

If clarification is needed, generation stops successfully with `status: awaiting_answers`, without producing a game. The run contains `questions.md`, `questions.json` and `answers.template.json`, and the terminal prints the exact resume command. Edit the template or create a separate JSON file mapping question IDs to answers, for example:

```json
{
  "movement": "Swim with inertia underwater, but jump normally on dry platforms.",
  "failure": "Instant retries at the current room's checkpoint."
}
```

Use the actual IDs from your run; every pending question needs a nonempty answer. Then:

```powershell
npm run gen -- --resume "outputs/<run>" --answers "outputs/<run>/answers.template.json"
```

A later round may ask new questions if an answer introduces an important ambiguity. The pipeline never treats missing answers as permission to invent decisions. To resume an interactive interview, use `--resume` without `--answers`. Runs interrupted while writing the design reuse the completed interview and saved answers when resumed. Runs with a completed design but failed implementation can also be resumed without answers; a new build preserves all earlier attempts. A validated run is finished: start a new run to generate another game or change the brief.

## How variety and fidelity are handled

1. **Grounded requirements.** Extract explicit constraints with exact quotes from the user's idea and answers. Separate assumptions from requirements and ask about consequential ambiguity.
2. **Design exploration.** Compare three mechanically different approaches consistent with the brief. Select by user intent, not random mechanics. Choose specific movement tuning, combat or no combat, world structure, failure rules, progression and visual feedback. The only fixed genre constraint is meaningful 2D platforming; arenas, precision rooms, exploration, combat runs and local multiplayer are possible.
3. **History-aware design.** Supply mechanical identities from up to eight recent design contracts in `outputs/` so the model can avoid falling back to its last template. Explicit requests take priority over novelty. Older HTML-only runs are skipped. No external corpus or cross-user history is used.
4. **Implementation contract.** Preserve requirement IDs/text verbatim and specify their implementation and observable acceptance behavior. Define interacting signature mechanics, concrete level geometry, controls, state architecture and reproducible behavioral tests. Invalid/incomplete structured model responses are retried up to twice and archived; they never silently fall back to a generic game.
5. **Real browser behavior.** Serve each candidate over loopback HTTP and check HTML structure, JavaScript/runtime/console/resource errors. Run the design's own controls and tests rather than a fixed ArrowRight/Space sequence. Require movement, signature-mechanic and recovery scenarios, with every signature mechanic linked to a test.
6. **Fidelity review and repair.** After browser checks pass, a fresh model request inspects the actual code and browser evidence against every requirement and signature mechanic. Missing features, generic substitutions and blocking playability issues go into the same repair loop as runtime errors. Traversal witnesses are also mandatory (see below). Only a candidate passing startup, behavioral, traversal and fidelity checks is published as `game.html`.

All art, CSS, scripts and level data remain inline. No libraries, CDN, build step or network assets are allowed. Controls, game structure and objective follow the contract; the backend no longer imposes a single-player collect-coins-and-reach-a-flag course.

## Browser test interface

Generated games expose `window.__gameTest.snapshot()`, returning a fresh JSON-serializable copy of real live game state. It includes a frame `tick`, primary `player` state and custom ability/world/match fields used by the contract's tests. The function must not mutate state or fabricate feature flags. Normal play uses the same logic and starts without a test harness.

Tests use a small validated data format: keyboard `press`, `hold`, `down`, `up`, `wait`, and snapshot `assert` steps. Input actions accept either `key` or simultaneous `keys`, never both. Controls should list alternatives separately and use `keys` arrays for modifier chords. Explicit model display notation such as `ArrowRight / KeyD` is normalized into separate bindings; `ShiftLeft + KeyR` becomes a chord. Test actions must choose a concrete binding; undeclared keys and ambiguous slash-separated test inputs remain errors. `hold` releases its temporary keys at the end; sequential holds do not overlap. Use `keys: ["ArrowRight", "KeyF"]` to move and fire together, or `down`/`up` to hold an input across other actions. Temporary holds preserve inputs already held by `down`. Assertions compare actual fields using `eq`, `ne`, `gt`, `gte`, `lt`, `lte` or `changed` from the initial snapshot. Each scenario uses an independent browser context, fresh page and paused Playwright virtual clock, installed before game scripts. Only `hold`, `press` (50ms) and `wait` advance timers and animation frames; assertions and automation overhead consume no game time. Real keyboard events still go through the game input handlers. RAF/fixed-step quantization still applies, so test thresholds need sensible margins. For later-level scenarios, declare `levelId` matching the design traversal plan. The runner calls `__gameTest.reset({levelId})`, verifies `snapshot().traversal.levelId`, then performs normal keyboard/RAF testing. This fixture must use legitimate level-entry state and dismiss title/pause panels. It does not establish that the player can reach that level: independent traversal witnesses still start at the true campaign entry. Tests without `levelId` exercise normal entry and must include any Enter/start input themselves. Zero-tick failures include a stalled-simulation diagnostic. No assertion tolerances are silently widened and failed checks are not retried until they happen to pass. No model-authored test code is evaluated. Timed actions are limited to two seconds each and twenty seconds total; full generation validation has a 120-second browser budget. Results retain before/after snapshots (including failures), each step, held inputs, elapsed virtual time, and the exact failed step. Repair prompts receive this evidence, not just an error string. The code reviewer also checks that instrumentation and tests represent real mechanics.

Standalone validation now requires traversal evidence by default:

```powershell
npm run validate -- "outputs/<run>/game.html"
```

This command runs startup and traversal replay against the runtime geometry inventory. Add `--design "outputs/<run>/design.json"` to cross-check the exact level/seed inventory against the design. `--smoke-only` explicitly runs only legacy startup checks and reports that reachability was not checked. Full design-specific behavioral tests and model fidelity review run through generation/resumption.

## Output files

Each new request creates a unique directory under `outputs/`:

```text
outputs/<timestamp>-<suffix>/
  idea.txt
  session.json                 # original idea, answers, interview phase
  interview-0.json             # grounded requirements and questions
  interview-0.response-0.txt    # raw model response (all attempts kept)
  questions.md
  questions.json               # current pending questions, empty after design lock
  answers.template.json
  answers.draft.json           # if answers were entered interactively
  design.json                  # locked contract, candidates, mechanics, tests
  design-<round>.json
  history.json                 # prior design summaries sent to the model
  rules.md                     # readable design summary
  result.json                  # awaiting_answers/generating/validated/failure status
  game.html                    # only after behavior and fidelity checks pass
  build-<timestamp>-<suffix>/
    attempt-0.html
    attempt-0.browser.json     # runtime and behavioral evidence
    attempt-0.json             # combined validation result
    review-0.json              # per-requirement/mechanic fidelity assessment
    review-0.response-0.txt
    ...
    result.json
    game.html
```

Every model response, invalid-response diagnostic, HTML revision and validation report is saved. Resume attempts create new build directories. CLI failures save timestamped error reports in the run directory. Generated outputs and credentials are ignored by Git.

Open the final `game.html` with your IDE's Live Server or any static HTTP server.

## Completion and accessibility validation

Every new design declares `traversal: {version: 1, levels: [{id: "tower", mode: "completion"}], seeds: [0]}`. Enumerate every level/room/arena. Use `completion` for a level with a goal, exit or progression objective; use `accessibility` for a genuinely open-ended arena or sandbox. Both modes require all playable standing surfaces and regions to be reached, including optional branches. Only completion mode requires a real successful finish. Authored levels use seed 0; procedural games must use a finite set of supported seeds and validate every one. Arbitrary untested procedural layouts are not certified.

Generated HTML must include `window.__gameTest.traversal`:

- `version: 1` and `fixedDt`, matching the normal game timestep.
- `describe()`: the full level/seed inventory, derived from the actual collision registry. Each level has `id`, `mode`, `surfaces` and `regions`; every rectangle has stable `id`, `x`, `y`, `w`, `h`. Split disconnected playable parts of one collider. Walls, ceilings, scenery and hazard-only geometry are excluded, but never exclude a platform simply because it is hard to reach. Include moving lifts, unlockable bridges and secrets.
- `routes()`: witness routes `{id, seed, steps: [{keys: ["ArrowRight", "Space"], frames: 30}, ...]}`. Each route starts from a full normal new-game spawn. Routes may branch to cover optional areas, but cannot start at an unlocked checkpoint, teleport, load saved state or skip earlier levels. A step only contains keys and frames.
- `reset({seed})`: the real new-game reset; pause automatic simulation while the validator steps manually.
- `step({keys})`: advance exactly one fixed physics tick through the same input edges, movement, abilities, collision, hazards and world-update functions used in normal play. No test-only assistance or easier physics. Return the real snapshot.

Traversal snapshots extend the existing API with `player.w/h`, `surfaces`, `regions`, and `traversal: {levelId, completedLevels: [], recoveries: 0}`. Player snapshots include `x,y,w,h,vx,vy,onGround,alive`. Live geometry must contain every declared entry for the current level, including disabled/locked entries with zero width until usable. Coordinates reflect moving platforms and the active seed's actual layout. Completion flags come from real objective/exit logic. A normal recovery may move the player, but must not reset the monotonic physics tick.

`traversal.js` replays every frame in Chromium and observes player/body rectangles against actual live geometry. Landing requires a living, grounded player whose feet overlap the platform top; merely flying past it does not count. Regions require physical overlap. All targets and completion-mode levels must be covered for every seed. This tests ceilings, collisions, ability gates, switches, moving platforms and other mechanics through the game's own simulation instead of relying on a flat-ground jump-distance estimate.

The report in `attempt-N.browser.json` includes `traversal.coverage`: visited/missing surface and region IDs, successful level completions, last player positions, recovery counts and per-route tick counts. An absent route is reported as **not proven reachable**, rather than claiming mathematical impossibility. Such failures enter the repair loop. The model can correct an invalid route or adjust impossible geometry/physics, while preserving mechanics and all targets. No passing game is published before this gate succeeds. A missing API fails explicitly; it never silently falls back to startup checks.

The fidelity reviewer additionally compares the geometry inventory to the code, checks that the manual step shares normal physics, and rejects omitted surfaces, fake completion, teleportation and dishonest accessibility modes. Replay proves routes for the declared levels/seeds, assuming that adapter is faithful; it is not a proof that every possible game state avoids softlocks or that an undisclosed layout exists nowhere. It also does not promise an easy jump or comfortable timing for every player. Design instructions request conservative jump margins and account for player size, ceilings, release height and moving platforms.

**Existing output files:** older games, including those generated before this check, have no traversal interface and cannot be certified automatically. Regenerate them to gain this validation; existing files are not edited. A resumed unfinished legacy design gets a traversal-plan upgrade while preserving a backup of its original design. For deliberately limited startup checking of an old file:

```powershell
npm run validate -- "outputs/<old-run>/game.html" --smoke-only
```

Witness limits are 64 routes, 4000 input steps per route, 2400 ticks per step and 120000 simulated ticks overall. Validation has a 120-second browser budget. Exhausting a budget fails validation; it never counts as success. Failure reports and prior HTML attempts remain in the run directory.

## Limits and tests

This pipeline cannot change model pretraining or guarantee uniqueness, fun or balance. Completion/accessibility now requires replay witnesses as described above, with their declared-inventory and seed limits. Model review remains a judgment, and manual playtesting is useful for finding untested softlocks and judging movement feel. Repeated explicit requests for the same mechanics can intentionally produce similar games.

```sh
npm test
```

Tests cover clarification/resumption, requirement provenance and preservation, design/review contracts, history loading, bounded test actions, quality-gate repairs, and actual Chromium behavior including custom controls, impossible jumps, blocking walls, ability-assisted crossings, inaccessible side platforms, seed coverage, missing traversal support and traversal-triggered repair. Model calls in tests are mocked; browser checks run for real.

Core modules: `pipeline.js` orchestrates CLI and stages; `designWorkflow.js` persists interviews and design; `designContracts.js` validates structured outputs; `prompts.js` defines design/implementation/review instructions; `playtests.js` executes behavioral scenarios; `traversal.js` verifies completion and area accessibility; `qualityReview.js` enforces fidelity; `repairLoop.js` manages attempts; `htmlRunner.js` manages Chromium and HTTP; `codexGenerator.js` handles ChatGPT-authenticated model calls.
