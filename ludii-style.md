# Ludii generation and repair guide

Target the installed Ludii version. Treat written rules as the specification and working reference games as syntax evidence. A ludeme is a typed game-description building block, not arbitrary Lisp. Valid names can still be invalid in a particular argument position.

## Structure and types
- Use `(game "Name" (players 2) (equipment { ... }) (rules ...))`. Put `(define ...)` before the game and optional `(metadata ...)` after it.
- Parentheses form expressions; braces form arrays only where supported. Preserve the exact argument order, labels, case, and nesting of a matching reference pattern.
- Distinguish Boolean conditions, integer/site values, regions (sets of sites), move generators, and consequences. `(is In ...)` needs a site and region, not a piece declaration. `(ahead ...)` gives a site, not a region. `(what at:...)` gives a component ID.
- Do not invent English-like tokens. Failed guesses in this project include `HexDirections`, `Directions`, `centreSite`, `NoPieceAt`, `Dead`, and `Repeated`. An error identifies a rejected use, not necessarily a universally forbidden word.

## Boards, sites, and setup
- Square example: `(board (square 7))`. Hexagonal example: `(board (hex Hexagon 3) use:Vertex)`, not `(hex 3)`. `Hexagon` describes shape, not a capture direction.
- Choose cells versus vertices deliberately. Keep placement, movement, capture, and scoring on consistent site types. Hex-cell adjacency differs from adjacency between hexagon corners.
- Use demonstrated directions such as `Orthogonal`, `Diagonal`, or `(directions {FR FL})` with a compatible board/player orientation. Do not substitute shape names or guess `Left`/`Right` direction tokens.
- Valid placement patterns: `(place "Pawn1" (sites Row 1))`, `(place "King1" coord:"E1")`, `(place "Rook1" {"A1" "H1"})`. Avoid guessed wrappers `(row 0)`, `(site "D4")`, and numeric `coord:0`.
- Rows are zero-indexed. Placing on a whole row fills that region; it does not place just the number of pieces mentioned in prose. Check counts, overlaps, bounds, and initial hand contents.

## Moves and consequences
- A piece name does not supply movement. Define movement on the piece and activate it with `(forEach Piece)`, or use a demonstrated explicit move pattern. Neither `(move Queen)` nor `(move Slide (piece "Queen"))` means queen movement.
- Empty-site step: `(move Step Orthogonal (to if:(is Empty (to))))`.
- Placement: `(move Add (to (sites Empty)))`. For a specific component, copy a matching Add signature; do not guess ownership arguments inside `(piece ...)`.
- Combine two alternatives as `(or MOVE1 MOVE2)`; use `(or { MOVE1 MOVE2 MOVE3 })` for an array. These are schematic placeholders, not literal tokens. Do not wrap an existing move generator in `(move (or ...))`.
- `(then ...)` is a consequence attached to a supporting move/operator, not a standalone piece move or an alternative action. Valid pattern: `(move Add (to (sites Empty)) (then "CaptureSurroundedPiece"))`. Do not give a piece only a `(then ...)` body.
- Enclosure starts with `(enclose (from (last To)) Orthogonal (between ...))`, not `(enclose (last To) ...)`. Copy the full capture pattern from Go, including its `(apply ...)` placement.
- `(from)`, `(to)`, and `(between)` depend on evaluation context. Use `(last To)` for the completed move where appropriate. An unbound context may compile but fail during initialization/play.

## Names and rule fidelity
- Copy helper definitions and their dependencies, not just calls. `InitialPawnMove` and `RememberPieceHasMoved` are defined locally in Chess; they are not automatically imported from the reference file. Macro arguments must match the definition.
- Region and component names must match exactly. Defining `HomeRowP1`/`HomeRowP2` does not define `HomeRow`. The references use `(regions "Promotion" P1 (sites Top))` with `(sites Mover "Promotion")`.
- Do not guess extra parameters for `count` or `is Line`. For restricted piece counts, a demonstrated pattern is `(count Sites in:(sites Occupied by:Mover container:"Board" component:"Pawn"))`. It counts occupied sites; stacked-piece counts require another pattern.
- Verify who wins, whose moves are checked, capture ownership, promotion, repetition, and piece restrictions on winning lines. Generic `(is Line 3)` must not silently replace a requirement for three pieces of one named type. Metadata text does not implement rules.

## Repair discipline
- Unknown token: verify its spelling, context, and macro dependencies. Unexpected syntax: inspect the whole enclosing expression's types and signature, not just the named token.
- A generic “Could not create game” error does not locate the defect at the outer `game`; inspect nested move composition, equipment, and arguments. Java stack-trace lines are not `.lud` line numbers.
- Review all errors while preserving the specification. Do not remove required mechanics merely to compile. Avoid repeating a rejected substitution.
- Prefer minimal graphics metadata. A specialized board style can compile yet fail to render; omit uncertain overrides. Do not invent database IDs or claim GUI validation from headless tests.
- Return one complete game in a single lud code block when requested. Compilation, execution, rule fidelity, and GUI rendering are separate checks.
