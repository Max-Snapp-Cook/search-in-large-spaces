# Search in Large Spaces

A command-line prototype for generating board games with Gemini and checking them with the Ludii game engine. Give it a game idea, and it writes plain-English rules, translates those rules into a `.lud` game description, and asks the model to fix code that fails engine validation.

The current project explores game ideas through generation and repair. It does not yet rank games, evaluate how fun or balanced they are, or have LLM agents play against each other.

## How it works

```text
Game idea + reference games in examples/
                  |
                  v
        Gemini writes English rules
                  |
                  v
        Gemini translates rules to .lud
                  |
                  v
        Java bridge checks the game <---------+
                  |                           |
          +-------+--------+                  |
          |                |                  |
        Pass          Game error              |
          |                |                  |
     Save game.lud    Gemini repairs code ----+
                      (up to MAX_REPAIRS)
```

Ludii is the game engine used here. A `.lud` file describes a game's board, pieces, setup, moves, and ending conditions using building blocks called *ludemes*. The JavaScript code coordinates generation; the Java bridge lets it compile and run games in Ludii without opening a graphical window.

Install dependencies with `npm install`. Copy `.env.example` to `.env` (or add
the settings to your existing `.env`) and set `GEMINI_API_KEY` to a key from
[Google AI Studio](https://aistudio.google.com/apikey).
Optionally set `GEMINI_MODEL`; the default is `gemini-3.8-flash`.

1. Read every `.lud` file directly inside `examples/`. The supplied references are Chess, Go, Shogi, and Tic-Tac-Toe.
2. Use `rulesPrompt` to turn the idea into complete English rules.
3. Use `translatePrompt` to convert those rules into Ludii code. The prompt asks the model to use only ludemes found in the references; this is a model instruction, not an enforced whitelist.
4. Save the rules and first code attempt, then launch Java to compile the game, initialize its starting state, and generate its initial legal moves.
5. If a game error occurs, send the original rules, reference games, latest code, and engine feedback to `repairPrompt`. Save and validate each revision until one passes or the repair limit is reached.

All three prompts use the same Gemini model through LangChain's `ChatOpenAI` client and Gemini's OpenAI-compatible endpoint. Despite the client name, this project uses a Gemini API key, not an OpenAI API key.

## Setup

Run the commands below from the repository root.

You need:

- **Node.js 22 or newer and npm**, as required by the locked dependencies.
- **A Java JDK**, with both `java` and `javac` available on `PATH`. Use a matching compiler and runtime compatible with the supplied Ludii JAR.
- **`Ludii.jar`**, included at the repository root. An alternative location can be configured with `LUDII_JAR`.
- **A Gemini API key and network access** to generate or repair games. Local validation and the Node tests do not require an API key.

Python and a Python virtual environment are not used by this project.

Install the JavaScript dependencies:

```sh
npm ci
```

Create a file named `.env` in the repository root with:

```dotenv
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
MAX_REPAIRS=5
```

Only `GEMINI_API_KEY` is required for generation. The other two values shown are the defaults. `.env` is ignored by Git.

Build the Java bridge, then check the supplied Tic-Tac-Toe game:

```sh
npm run build:bridge
npm run run:lud -- examples/tic-tac-toe.lud
```

A successful check prints JSON containing `"ok": true` and `"stage": "complete"`. Build the bridge before generating games, and rebuild it after changing `LudiiBridge.java` or replacing the JAR. The generated `LudiiBridge.class` file is ignored by Git.

### Configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | None | Required for generation and repair requests. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Model used by all three prompt chains. |
| `MAX_REPAIRS` | `5` | Maximum repairs after the initial attempt; must be a nonnegative integer. `0` validates once without repairs. |
| `LUDII_JAR` | `Ludii.jar` at the repository root | Path to the engine JAR. |
| `JAVA_BIN` | `java` | Java runtime executable name or full path. |
| `JAVAC_BIN` | `javac` | Java compiler executable name or full path. |

For example, custom Windows paths can be added to `.env` as:

```dotenv
LUDII_JAR="C:/tools/Ludii.jar"
JAVA_BIN="C:/path/to/jdk/bin/java.exe"
JAVAC_BIN="C:/path/to/jdk/bin/javac.exe"
```

## Generate a game

Pass the idea as one quoted argument:

```sh
npm run gen -- "a two-player capture game on a hexagonal board"
```

Running `npm run gen` without an idea uses that same example idea. The pipeline prints the generated rules, initial code, repair progress, and successful output path.

Each run makes two initial model requests: one for rules and one for code. Each repair adds another request. With the default repair limit, there can be up to six validation attempts and seven model requests. Reference games and generated content are sent to Gemini as part of those requests.

### Output files

After the initial rules and code have been generated, the pipeline creates a unique directory under `outputs/`, named with a timestamp and a random suffix:

```text
outputs/<timestamp>-<suffix>/
  rules.md             Original English rules
  attempt-0.lud        Initial generated code
  attempt-0.json       Validation result for that code
  attempt-1.lud        First repair, if needed
  attempt-1.json       Validation result for the first repair
  ...
  result.json          Latest status and validation result
  game.lud             Final code, written only after successful validation
```

`result.json` records the number of repairs, the repair limit, the last attempt's path, and its validation result. Its status is one of:

| Status | Meaning |
| --- | --- |
| `repairing` | The latest validation failed and a repair is being requested. |
| `validated` | A version passed validation and was saved as `game.lud`. |
| `repair_limit_reached` | Game errors remain after the allowed repairs. |
| `validation_failed` | A setup, input, process, or timeout problem stopped validation. |
| `repair_failed` | The repair callback failed, for example because an API request failed. |

Failures exit with a nonzero code. If a run fails before the output directory is created, such as during the initial model requests, there will be no saved run report. Generated outputs are ignored by Git.

## Validate a game or run random games

You can check an existing `.lud` file independently of Gemini:

```sh
npm run run:lud -- examples/tic-tac-toe.lud
```

To also run ten random games, with a limit of 500 moves per game:

```sh
npm run run:lud -- examples/tic-tac-toe.lud 10 500
```

Replace the example path with your generated `outputs/<run-directory>/game.lud` to test that game. The optional arguments are the number of random games (default `0`) and move limit (default `500`). These are random engine playouts, not LLM-controlled players. The runner handles Windows and Unix classpath separators.

The JSON report includes:

| Field | Meaning |
| --- | --- |
| `ok` | Whether the requested checks finished without a reported error. |
| `stage` | `complete` on success, or the stage that failed. |
| `errors` | Reported error messages. |
| `diagnostics` | Engine console output and stack traces, captured separately from JSON. |
| `gameName`, `players`, `initialLegalMoves` | Game information, when validation reached those steps. |
| `stats` | Requested and completed playouts, wins by player, draws, move-limit count, and average moves. |

Only `compile`, `initialize`, and `playout` failures become model repair feedback. `setup`, `input`, `process`, and `timeout` failures stop the repair loop because changing game code is not the appropriate automatic response. Feedback includes diagnostics and is capped at 20,000 characters.

Each Java build or validation process has a default 60-second timeout. For validation, that limit covers the entire process, including all requested playouts. A process timeout returns a failure without partial stats.

### What passing validation means

The generation command checks compilation, initialization, and initial legal-move generation. It does **not** run full games by default or require a positive initial move count.

Even when random playouts are requested, hitting the move or engine turn limit is counted in `moveLimitReached` and does not by itself fail validation or trigger repairs. Completed games without a single player winner count as draws; the statistics are not a detailed team or ranking analysis.

A passing result does not establish balance, novelty, fun, exact agreement with the English rules, or correct graphical rendering. The repair prompt asks the model to preserve the original rules, but rule fidelity is not checked automatically.

## Where to change things

| File or directory | Responsibility |
| --- | --- |
| [`pipeline.js`](./pipeline.js) | Command-line entry point; configures Gemini, loads examples, builds prompt chains, and starts generation and repair. |
| [`prompts.js`](./prompts.js) | The rules, translation, and repair prompts. Start here to change the design instructions or repair guidance. |
| [`repairLoop.js`](./repairLoop.js) | Extracts code from model responses, saves attempts, and controls validation and retries. |
| [`ludiiRunner.js`](./ludiiRunner.js) | Builds and launches the Java bridge, enforces process limits, parses results, and selects repairable errors. |
| [`LudiiBridge.java`](./LudiiBridge.java) | Calls the Ludii engine to compile, initialize, generate moves, and optionally run random games; emits JSON. |
| [`examples/`](./examples/) | Reference `.lud` games included in every generation and repair prompt. Add files here to expand the reference material. |
| [`ludiiRunner.test.js`](./ludiiRunner.test.js) | Tests result parsing, failure classification, and input/setup checks. |
| [`repairLoop.test.js`](./repairLoop.test.js) | Tests successful validation, repair limits, saved attempts, and failure handling using mock callbacks. |
| [`package.json`](./package.json) | Dependencies and the three npm commands. |

The reusable runner also accepts options from JavaScript:

```js
import { validateWithLudii, repairFeedback } from "./ludiiRunner.js";

const result = await validateWithLudii("examples/tic-tac-toe.lud", {
  playouts: 10,
  maxMoves: 500,
  timeoutMs: 60_000,
});

console.log(result);
const feedback = repairFeedback(result); // Error text for repairable failures; otherwise null.
```

`repairUntilPlayable()` in `repairLoop.js` accepts `validationOptions: { playouts: 10, maxMoves: 500 }` if you want playouts included in the generation loop. The current generation CLI does not expose those options.

## Tests and troubleshooting

Run both Node test files:

```sh
node --test ludiiRunner.test.js repairLoop.test.js
```

These tests do not make model requests or run actual engine playouts. To check the real Java integration, use the build and Tic-Tac-Toe commands above, followed by the random-playout command.

| Problem | What to check |
| --- | --- |
| Missing `GEMINI_API_KEY` | Add it to `.env` in the repository root before running `gen`. |
| Java or compiler not found | Install a JDK and check `PATH`, `JAVA_BIN`, and `JAVAC_BIN`. |
| Missing JAR or bridge class | Check `LUDII_JAR`, then run `npm run build:bridge`. |
| Invalid bridge response or Java version error | Read `diagnostics`, check that the JAR and JDK are compatible, and rebuild with the matching compiler. |
| Repair limit reached | Inspect `rules.md`, the last `.lud` attempt, and its JSON feedback. Adjust the idea, prompts, or references; raise `MAX_REPAIRS` only if more attempts are useful. |
| Validation timeout | Try fewer playouts or a lower move limit; callers of `validateWithLudii()` can also adjust `timeoutMs`. |

## Possible next steps

The earlier project notes describe several directions that are not implemented yet: evaluating game quality, iteratively improving rules based on critique, adding selected generated games to the references, and having agents play against each other. The current implementation provides the generation, engine validation, repair, and saved results needed to experiment with those ideas.
