import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import game.Game;
import main.grammar.Description;
import other.context.Context;
import other.trial.Trial;

/** Headless validation: LudiiBridge game.lud [playouts=0] [maxMoves=500]. */
public final class LudiiBridge {
    public static void main(String[] args) {
        // Reserve stdout for JSON. Ludii diagnostics and stack traces go to stderr.
        PrintStream output = System.out;
        System.setOut(System.err);
        Map<String, Object> result = new LinkedHashMap<>();
        List<String> errors = new ArrayList<>();
        result.put("ok", false);
        result.put("stage", "input");
        result.put("errors", errors);
        result.put("stats", null);
        int exitCode = 1;
        try {
            if (args.length < 1 || args.length > 3)
                throw new IllegalArgumentException("Usage: LudiiBridge game.lud [playouts=0] [maxMoves=500]");
            int playouts = args.length > 1 ? Integer.parseInt(args[1]) : 0;
            int maxMoves = args.length > 2 ? Integer.parseInt(args[2]) : 500;
            if (playouts < 0 || maxMoves < 1)
                throw new IllegalArgumentException("playouts must be >= 0 and maxMoves must be >= 1.");
            String source = new String(Files.readAllBytes(Paths.get(args[0])), StandardCharsets.UTF_8);
            result.put("stage", "compile");
            Game game = (Game) compiler.Compiler.compileTest(new Description(source), false);
            if (game == null)
                throw new IllegalStateException("Ludii returned no game. See diagnostics for compiler errors.");
            result.put("gameName", game.name());
            result.put("players", game.players().count());
            result.put("stage", "initialize");
            Context initial = new Context(game, new Trial(game));
            game.start(initial);
            result.put("initialLegalMoves", game.moves(initial).moves().size());

            Map<String, Object> stats = new LinkedHashMap<>();
            Map<String, Object> wins = new LinkedHashMap<>();
            for (int p = 1; p <= game.players().count(); p++) wins.put(String.valueOf(p), 0);
            stats.put("requested", playouts);
            stats.put("completed", 0);
            stats.put("draws", 0);
            stats.put("moveLimitReached", 0);
            stats.put("wins", wins);
            stats.put("averageMoves", 0.0);
            result.put("stats", stats);
            int completed = 0, draws = 0, limited = 0;
            long totalMoves = 0;
            for (int i = 0; i < playouts; i++) {
                result.put("stage", "initialize");
                Context context = new Context(game, new Trial(game));
                game.start(context);
                int startMoves = context.trial().numMoves();
                result.put("stage", "playout");
                // Let Ludii handle the game mode and forced passes.
                Trial trial = game.playout(context, null, 0.0, null, 0, maxMoves, new Random());
                totalMoves += trial.numMoves() - startMoves;
                if (!trial.over() || game.checkMaxTurns(context)) {
                    limited++;
                } else {
                    completed++;
                    int winner = trial.status().winner();
                    if (winner > 0 && wins.containsKey(String.valueOf(winner))) {
                        String key = String.valueOf(winner);
                        wins.put(key, ((Integer) wins.get(key)) + 1);
                    } else {
                        draws++;
                    }
                }
                stats.put("completed", completed);
                stats.put("draws", draws);
                stats.put("moveLimitReached", limited);
                stats.put("averageMoves", totalMoves / (double) (i + 1));
            }
            result.put("ok", true);
            result.put("stage", "complete");
            exitCode = 0;
        } catch (LinkageError error) {
            result.put("stage", "setup");
            errors.add(error.toString());
            error.printStackTrace(System.err);
        } catch (Exception | StackOverflowError error) {
            errors.add(error.toString());
            error.printStackTrace(System.err);
        }
        output.println(json(result));
        output.flush();
        System.exit(exitCode);
    }

    // Small JSON writer avoids requiring another JAR.
    private static String json(Object value) {
        if (value == null) return "null";
        if (value instanceof Number || value instanceof Boolean) return value.toString();
        if (value instanceof Map) {
            StringBuilder out = new StringBuilder("{");
            for (Map.Entry<?, ?> entry : ((Map<?, ?>) value).entrySet()) {
                if (out.length() > 1) out.append(',');
                out.append(json(entry.getKey().toString())).append(':').append(json(entry.getValue()));
            }
            return out.append('}').toString();
        }
        if (value instanceof Iterable) {
            StringBuilder out = new StringBuilder("[");
            for (Object item : (Iterable<?>) value) {
                if (out.length() > 1) out.append(',');
                out.append(json(item));
            }
            return out.append(']').toString();
        }
        StringBuilder out = new StringBuilder("\"");
        for (char c : value.toString().toCharArray()) {
            if (c == '"' || c == '\\') out.append('\\').append(c);
            else if (c < 32) out.append(String.format("\\u%04x", (int) c));
            else out.append(c);
        }
        return out.append('"').toString();
    }
}
