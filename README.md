# search-in-large-spaces

## Run the Gemini pipeline

Install dependencies with `npm install`. Copy `.env.example` to `.env` (or add
the settings to your existing `.env`) and set `GEMINI_API_KEY` to a key from
[Google AI Studio](https://aistudio.google.com/apikey).
Optionally set `GEMINI_MODEL`; the default is `gemini-3.8-flash`.

```powershell
npm run gen -- "a two-player capture game on a hexagonal board"
```

The pipeline uses Google's [OpenAI-compatible Gemini endpoint](https://ai.google.dev/gemini-api/docs/openai)
through the existing LangChain dependency. Both rules and Ludii code are generated
with Gemini and saved under `outputs/`. A Python virtual environment is not required.


## Validate and run a generated game

`LudiiBridge.java` compiles a description, initializes it, generates initial legal
moves, and optionally runs random playouts. `ludiiRunner.js` launches Java with a
60-second total timeout and returns JSON. The generation pipeline validates each
generated game and asks Gemini to repair compilation/startup errors automatically.
Set `MAX_REPAIRS=5` in `.env` to allow five repairs after the initial attempt
(the default). Set it to `0` to validate once without repairs.

Each run saves `rules.md`, numbered `attempt-N.lud` files and their matching
`attempt-N.json` validation reports, plus `result.json` with the final status.
Only successful validation produces `game.lud`. Setup/process failures stop the
run immediately, and failures or an exhausted repair limit give a nonzero exit
code. The loop preserves the original rules and sends the latest code and Ludii
feedback to each repair request.

By default this loop checks compilation, initialization, and initial legal-move
generation; it does not run random games. You can separately use `run:lud` below
for playouts. The reusable `repairUntilPlayable()` helper also accepts
`validationOptions: { playouts: 10, maxMoves: 500 }`; move-limit results alone do
not trigger repairs.

1. Install a Java JDK (including `javac`, not just the Java runtime).
2. Put the [Ludii JAR](https://ludii.games/download.php) at `Ludii.jar` in this
   directory, or set `LUDII_JAR=C:/path/to/Ludii.jar` in `.env`.
3. Ensure `java` and `javac` are on PATH. Alternatively set `JAVA_BIN` and
   `JAVAC_BIN` in `.env` to their full executable paths. Use a matching JDK/runtime.
4. Build the bridge, then validate a file:

```powershell
npm run build:bridge
npm run run:lud -- examples/tic-tac-toe.lud
npm run run:lud -- outputs/2026-10-15T18-08-18-952Z/game.lud 10 500
```

The last two arguments are random playout count (default `0`, validation only)
and move limit per playout (default `500`). Rebuild after changing the Java source
or Ludii JAR. The runner handles Windows and Unix classpath separators.

To use the feedback from JavaScript:

```js
import { validateWithLudii, repairFeedback } from "./ludiiRunner.js";

const result = await validateWithLudii("outputs/my-run/game.lud", {
  playouts: 10,
  maxMoves: 500,
});
const feedback = repairFeedback(result);
// result.ok: validation/playouts ran without a reported exception.
// feedback !== null: pass this feedback and the current code to a repair prompt.
// !result.ok && feedback === null: handle a setup/input/process issue separately.
```

Results contain `ok`, `stage`, `errors`, `stats`, and `diagnostics`. Failures during
`compile`, `initialize`, or `playout` produce repair feedback. `setup`, `input`,
`process`, and `timeout` failures do not automatically request an LLM rewrite.
Ludii's console output is kept in `diagnostics` without corrupting the JSON.

Stats contain requested playouts, completed games, wins by player, draws,
`moveLimitReached`, and average moves across finished/limited playouts. Draws
mean completed games without a single player winner; this summary is intended
for ordinary competitive games, not detailed team/ranking analysis. Games hitting
the bridge or engine move/turn limit are counted separately. A process timeout
returns a failure without partial stats. Passing checks does not establish game
balance, rule fidelity, or GUI rendering correctness.

Run Node-side checks with `node --test ludiiRunner.test.js`. Actual engine tests
require the JAR and JDK: validate the supplied Tic-Tac-Toe, try random playouts,
then pass a malformed `.lud` and confirm `stage: "compile"` with diagnostics.

Steps to do/ Goals:

1. Have the LLM prompt to create a game using the examples given(future have its own generated games in the examples)
Figure out what we are going to prompt it. "Create a game that does not exits", "Using these games as referance create a game
that are complex or use aspects of the game", ....

2. Have a parameter whwere we would have to figure out how to filter out bad and good games. Thinking of havign a good 

3. LLM Chain and have it prompt against itself. How would we ask the prompt to make the game?
We can prompt a LLm to look at the game and ask it to evaluate and give a prompt in ways to improve the game.
maybe run it 5-10 times

4. Save the results via ludii runner so we can load the prompt into a file.

5. Luddii Bridge will then Load the Ludii file. 


What is Done thursday.
Hopefully get to this point: Agents versing together is a good demo (LLM versing each other)
If we dont get to this point just simply generate a new game that works using LLM Chain.




Kyle dont knows:

1. Luddi in general so running Ludii via bridge will it jsut take the chess pngs
2. How to get the agents to play each other(maybe get the LLM's to suggest moves) I dont know if we can 
give instructions to the agents.
3. Final evaluator in general but to figure out what is good and what is not
