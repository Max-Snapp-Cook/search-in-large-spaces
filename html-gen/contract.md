Technical requirements for game.js:

game.js is a plain browser script (no import/export, no require, no external libraries, images, fonts, or
network requests). It is loaded by a fixed index.html shell that already provides: the page layout, the
game title, player chips, a player-count picker, a Human/Computer setting per seat, a "whose turn / who won"
status line, Undo and Restart, a move log, a rules panel, a "pass the device" screen between human players in
hidden-information games, and computer opponents (random and a strong Monte Carlo search).
Do NOT build any of those yourself. game.js defines exactly two globals: window.GameEngine and window.GameView.

Any kind of tabletop game can be built this way: abstract board games (chess, go), card games (Uno, rummy,
poker-style, trick-taking), dice games, economic and trading games (Monopoly), tile and resource games (Catan),
race games, solo puzzles, and games for 1 to 8 players. Model every decision as a move by one player:
- Multi-part turns (roll, then buy, then build) are several consecutive moves by the same player, using a
  phase field in the state. Include an explicit "end turn" move when a player may take a variable number of actions.
- Decisions by other players (responding to a trade offer, discarding on a 7, blocking, bidding, challenging)
  make currentPlayer temporarily return that player.
- Trades, bids, and amounts must use a small set of discrete options (e.g. a few fixed offers or amounts),
  not free-form numbers, so the move list stays finite and small.
- Chance (dice, shuffles, card draws) uses the seeded RNG stored in the state; see GameKit below.

window.GameKit (provided by the shell, available when game.js runs):
  newSeed() -> integer seed (non-deterministic; use only in initialState and determinize)
  random(seed) -> [number in [0, 1), nextSeed]
  randInt(seed, n) -> [integer in 0..n-1, nextSeed]
  shuffle(array, seed) -> [newShuffledArray, nextSeed]
  rollDice(seed, count = 1, sides = 6) -> [arrayOfValues, nextSeed]
  standardDeck({ jokers = 0 }) -> 52 card codes like "AS", "10H", "QD" (+ "JK1".. jokers)
  cardRank(card) -> 1..13 (A=1, J=11, Q=12, K=13; jokers 0), cardSuit(card) -> "S" | "H" | "D" | "C" | null
  cardLabel(card) -> "Q♦", isJoker(card), SUITS = { S: "♠", H: "♥", D: "♦", C: "♣" }
  cardSVG(card, { width = 70, faceDown = false, highlight = false }) -> SVG markup string of a playing card
    (pass null or faceDown: true for a card back)
  dieSVG(value, { size = 48, color, pipColor }) -> SVG markup string of a die
  Custom cards (Uno, property deeds, resource cards) should be drawn by the game itself.

window.GameEngine — pure game logic with no DOM access (it is run headlessly for random playouts and AI search):
  name: string
  players: default number of players
  minPlayers, maxPlayers: optional supported range (default: exactly `players`)
  playerNames: optional array of display names, one per possible player, e.g. ["White", "Black"]
  playerColors: optional array of CSS colors, one per possible player (shown in chips, seats, and the log)
  rules: a concise plain-text rules summary shown in the rules panel
  initialState(numPlayers): returns the starting state (a plain JSON-serializable object). Store numPlayers in it.
    Shuffle/deal here using a seed from GameKit.newSeed(), and keep the next seed in the state.
  currentPlayer(state): the player who must decide now, numbered 1..numPlayers
  legalMoves(state): array of JSON-serializable moves; [] once the game is over.
    While the game is not over it must never be empty (offer a pass / end-turn move when needed).
    Make each move a complete action (e.g. { from: 12, to: 20 } or { play: "7H" }), not a partial selection.
  applyMove(state, move): returns a NEW state; never mutate the input state. It must be deterministic: the same
    state and move always give the same result, so all randomness comes from state.seed via GameKit
    (never Math.random). Players eliminated from the game (e.g. bankrupt) are skipped by currentPlayer.
  result(state): null while the game continues, otherwise one of
    { winner: playerNumber } | { winner: null } (draw) | { winners: [playerNumbers] } (shared win or team win)
    optionally with scores: [one number per player], shown in the final status.
  Every game must end: guarantee termination (e.g. a round or move limit after which the best score/most money wins)
  if play could go on forever.
  Keep legalMoves/applyMove/result fast: the computer opponent calls them tens of thousands of times per move.

  Optional, but REQUIRED when the game has hidden information or chance (hands, decks, face-down tiles, dice):
  hidden: true
  observe(state, player): the state as `player` may see it. Replace everything they cannot see with null
    (other players' hands become arrays of nulls of the same length, the deck becomes nulls, the seed becomes 0)
    but keep public information (hand sizes, discard piles, revealed cards, scores) unchanged.
  determinize(state, player): a NEW full state that is consistent with everything `player` knows, with all
    unknown information randomly re-dealt (reshuffle the unseen cards among other hands/deck keeping their sizes,
    and pick a fresh seed with GameKit.newSeed()). Rule: observe(determinize(s, p), p) must equal observe(s, p).
    The computer opponent searches on determinized states, so it never sees hidden cards or future dice.

  Optional, recommended:
  evaluate(state): array with one number in [0, 1] per player estimating how well each player is doing
    (e.g. share of victory points, money, or material). Strongly recommended for long games (economic,
    resource, or many-round games): the computer opponent uses it when its simulations are cut off.
  describeMove(state, move): short text for the move log, e.g. "rolled 8 and bought Oak Street". It must only
    reveal public information (say "drew a card", not which card).

Required LLM-player interface on GameEngine (also pure, deterministic, JSON-serializable, no DOM/network):
  Agents receive rules and these descriptions, NOT game.js source or the rendered board. Include ALL public
  information needed to understand and play the game; constants hidden in a JavaScript closure are not visible.

  agentContext(): returns an object with a nonempty `summary` string and the STATIC public game context.
    Include the complete board/map or topology, locations of terrain/resources/goals, coordinate conventions,
    class/card/resource definitions, and legends for any compact encodings. Boardless games describe their
    zones and card/action meanings instead. Prefer a compact map with an explicit legend to verbose cell prose.
    No state, private information, RNG seeds, or strategy advice. Do not repeat the full rules here.
    For randomly generated layouts, put the actual public layout in agentObservation instead.

  agentObservation(observed, player): receives ONLY observe(state, player) for hidden games, or a copy of state
    otherwise, with RNG seed fields removed. Never depend on hidden values or retained full state.
    Return an object with:
      self: { player, name, ...named current information for this player },
      metrics: { ...named, factual game-specific statistics for THIS player },
      endgame: { endingConditions, remaining, scoring, tiebreakers, uncertainty },
      ...other readable public information needed to decide now.
    Player numbers are always 1..numPlayers, never array indices. Identify opponents explicitly by player number.
    Use named goods/inventory fields and named classes, and make positions readable using agentContext's map.
    Include whose decision it is, phase/round, remaining actions, restrictions already used, visible hands,
    public objectives, opponents' public positions/resources/scores, and relevant public supply/board changes.
    Distinguish an applicable rule limit from an exhausted allowance: expose the limit, amount used this turn,
    and remaining allowance where relevant. Avoid ambiguous flags such as "limitActive" meaning "cannot act".
    Any explicit current availability must agree with legalMoves; turn-scoped restrictions reset with the turn.
    `metrics` must contain actual engine-derived facts such as score, completed orders, gates opened, or scoring
    breakdown where relevant; use {} if no such statistics exist. Never estimate an unavailable statistic.
    `endgame` is required for newly generated games. Its five fields are nonblank readable strings, each at
    most 800 characters. `endingConditions` names all immediate and scheduled ending triggers; `remaining`
    describes time remaining from the CURRENT position, specifying units, whose turns/actions, and whether
    the current turn/round is included. Give exact counts only when determinable from public information;
    conditional endings need an upper bound or "unknown", not an invented countdown. Do not assume
    round-robin order or equate a round with one decision. `scoring` explains what actually counts at the end
    (including carried vs banked resources); `tiebreakers` gives their ordered application, draws/shared wins,
    or "none". `uncertainty` describes early-ending possibilities and unknown timing, or explicitly says none.
    Keep these factual, including at terminal states; no strategy advice or hidden information.
    Runner move/time budgets are NOT game-ending rules. Example remaining text:
    "At most 3 rounds including this one; you have 1 action left this turn. A score victory can end it sooner."
    Handle initial, interrupted-turn, eliminated-player, and terminal states. Do not include past snapshots,
    opinions, strategy advice, hidden card identities, or seeds. Keep this compact and avoid duplicating context.

  describeAction(observed, move, player): returns { label: string, category: string } for a legal move.
    `label` (up to 500 characters) precisely describes the action and its known immediate effects/costs, e.g.
    "Travel to West Dairy at (4,7); spend 1 action", "Fill public Sampler: pay one of each good; score 9 points",
    or "End turn; forfeit 1 unused action". Never claim unknown dice/draw outcomes as guaranteed effects.
    When an action has no target and acts as a pass, label it explicitly as a pass with its actual cost;
    do not describe removing or collecting an object that is absent.
    `category` (up to 80 characters) is a stable readable action name such as "Travel", "Fill order", "End turn".
    Only the acting player receives this label: it may mention their own private cards but never other secrets.
    Do not generate strategy or an explanation of WHY a player should choose it. The player supplies that.
    This differs from describeMove(state, move), which remains a PUBLIC log description safe for opponents.

window.GameView — renders the game and turns user input into moves:
  mount(container, ctx): called once. container is an empty <div> about 900px wide (it may report width 0
    when headless, so do not depend on measured sizes). ctx = { play(move), engine, names, colors, kit }.
    Returns an object { update(state, info) }.
  update(state, info): called after every change (new move, undo, restart, player-count change). info = {
    legalMoves,  // legal moves the viewer may choose now ([] when it is not the viewer's decision)
    canMove,     // true when a human may move now; ignore input otherwise
    player,      // player who must decide now, or null when the game is over
    viewer,      // whose perspective to draw (bottom/near seat), or null to show everything (spectating / game over)
    players,     // number of players in this game
    lastMove,    // the move that produced this state, or null
    result       // engine.result(state)
  }
  In hidden-information games the state passed to update is already engine.observe(state, viewer) when viewer is
  not null, so draw null cards face down. Always handle both a full state and an observed state.
  Redraw from state on every update; do not keep game state anywhere else.
  When the human chooses a move call ctx.play(move) with a move from info.legalMoves. The shell checks legality
  and calls update again. For multi-step choices (select a piece, then a destination; pick a card, then a color),
  keep only the selection in the view, highlight the options, and clear the selection on every update.
  Moves that are not tied to a board location (Roll dice, Buy, End turn, Draw, Pass, trade offers) are shown as
  clearly labeled buttons generated from info.legalMoves.
  Lay out every player's area (hands, money, pieces, resources) for any supported player count, with the viewer's
  own area largest and nearest the bottom. Show public information such as hand sizes, money, scores, the
  deck/discard, the dice, and whose turn it is.

Make it look great: prefer inline SVG with a viewBox and width="100%" for boards; HTML elements are fine for
hands, panels, and buttons; canvas is also fine. Use a distinctive visual theme suited to the game, clear colors
matching playerColors, highlights for the selected piece, legal targets, and the last move, hover feedback, and
smooth CSS transitions where they help. Inject any CSS you need from game.js with a <style> element, scoped under
a class on your root element.

Skeleton:

```js
(function () {
  const K = window.GameKit;

  window.GameEngine = {
    name: "...", players: 2, minPlayers: 2, maxPlayers: 4,
    playerNames: ["...", "...", "...", "..."], playerColors: ["#...", "#...", "#...", "#..."],
    rules: "...",
    // hidden: true, observe(state, player) { ... }, determinize(state, player) { ... },
    initialState(numPlayers) {
      let seed = K.newSeed();
      /* e.g. let deck; [deck, seed] = K.shuffle(K.standardDeck(), seed); */
      return { n: numPlayers, turn: 1, seed /* ... */ };
    },
    currentPlayer(state) { /* ... */ },
    legalMoves(state) { /* ... */ },
    applyMove(state, move) { /* ... let roll; [roll, seed] = K.rollDice(state.seed, 2); ... */ },
    result(state) { /* ... */ },
    evaluate(state) { /* ... */ },
    describeMove(state, move) { /* ... */ },
    agentContext() { return { summary: "..." /* complete static public map and definitions */ }; },
    agentObservation(observed, player) {
      return { self: { player, name: "..." /* named inventory, position, visible hand */ }, metrics: {} /* public situation */ };
    },
    describeAction(observed, move, player) { return { label: "...", category: "..." }; },
  };

  window.GameView = {
    mount(container, ctx) {
      const root = document.createElement("div");
      root.className = "my-game";
      container.appendChild(root);
      let selected = null;
      return {
        update(state, info) {
          selected = null;
          // draw from info.viewer's perspective; on click: if (info.canMove) ctx.play(move)
        },
      };
    },
  };
})();
```
