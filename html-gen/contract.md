Technical requirements for game.js:

game.js is a plain browser script (no import/export, no require, no external libraries, images, fonts, or
network requests). It is loaded by a fixed index.html shell that already provides: the page layout, the
game title, player chips, a player-count picker, a Human/Computer setting per seat, a "whose turn / who won"
status line, Undo and Restart, a move log, a rules panel, a "pass the device" screen between human players in
hidden-information games, computer opponents (random and a strong Monte Carlo search), a guided Tutorial that
walks a new player through their first turns, and a Coach box that explains each turn with a Hint button.
You supply the words for these: quickStart, turnPhases, tutorial, explainTurn, and describeMove (below).
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
  quickStart: 3 to 5 short plain-text steps (each one sentence, under 160 characters) for someone who has never
    played: the goal, what a turn looks like, the key rule to remember, and how the game ends. Shown as the
    first page of the tutorial, e.g. ["Get four of your discs in a row to win.", "On your turn, click a column to drop a disc.", ...]
  turnPhases: the parts of one turn, in order, so the tutorial can teach a whole turn and show where the player is:
    [
      { id: "roll", name: "Roll", how: "Click Roll to throw both dice; your token moves that many spaces." },
      { id: "buy", name: "Buy or pass", sometimes: true,
        how: "If you land on an unowned street, click Buy to pay its price or Pass to leave it." },
      { id: "end", name: "End turn", how: "Click End turn when you're done; the next player rolls." },
    ]
    name is 1 to 3 words. how is one sentence (under 300 characters): what the player can do in this part and
    exactly what to click on screen, including the choices they have. Mark sometimes: true on a part that does
    not happen on every turn (buying only on unowned squares, discarding only on a 7, responding to a trade).
    Alternatives within one decision are one part, not several ("Play or draw": play a matching card, or draw
    if nothing matches). A game with one kind of move has a single part ({ id: "move", name: "Drop a disc", how }).
  turnPhase(state): the id of the turnPhases entry the current player is in right now (for example from the
    phase field in state). Must always return one of the ids while the game is running.
  tutorial: a guided first game for someone who has never played and will not read the rules. Its job: after one
    round the learner knows how to play a whole turn on their own. The shell starts a new game with the learner as
    player 1 and the computer as everyone else, shows quickStart and the parts of a turn (turnPhases), then runs
    the steps in order, one at a time, in a box above the board. On each of the learner's moves the box shows
    which part of the turn they are in, what they can do in it (that part's `how` and explainTurn), and then the
    step's own text. After the steps the learner plays one complete turn on their own with every legal move
    allowed, and the last page recaps the goal and each part of a turn.
    {
      players: 2,       // optional, defaults to `players`
      intro: "...",     // optional: one sentence shown under quickStart before the first step
      steps: [
        { choose(state, legalMoves) { return a move from legalMoves }, say(state, move) { return "..." } },
        { say(state) { return "..." } },   // no choose: an explanation step with a Next button
        ...
      ],
      outro: "...",     // last page: how to win, one strategy tip, what to try next
    }
    A step with choose() is a move. When it is player 1's turn, the board offers ONLY that move (the view
    highlights it, because it is the only entry in info.legalMoves) and the learner clicks it, or presses
    "Do it for me". When it is another player's turn, the learner presses Next and that player makes the move.
    A step without choose() just explains something (scoring, a new phase) and waits for Next.
    - Cover a full round: at least the learner's first 3 moves, including every part of a turn that is not marked
      sometimes (the learner must make a move in each one), and each opponent's turn as its own step(s) in turn order.
      Add an explanation step (no choose) whenever a new part of the turn or a new idea appears: what this part is
      for and what the choices are. Aim for 6 to 14 steps; do not play to the end of the game.
    - say(state, move) returns 1 to 3 short sentences (under 400 characters). The box already lists what the
      learner can do (the part's `how` and explainTurn), so for the learner's moves explain THIS choice: exactly
      what to click as it appears on screen ("Click the glowing column 4", "Click the Roll button"), what it does,
      why it is good here, and when you would pick a different option. For opponents' moves say what they are
      about to do and what it means for the learner. Use the real situation: the cards, dice, or target in
      `state`, and the chosen `move`.
      `state` is what player 1 can see (engine.observe(state, 1) in hidden-information games): describe only that.
    - choose(state, legalMoves) receives the full state and must return one of legalMoves, chosen by a rule that
      works for ANY shuffle or roll (e.g. "the card that matches the top card's suit, else draw"), never a
      hard-coded card or position that only exists in one deal. It must be deterministic (no Math.random).
    - The validator replays the tutorial several times with different random setups and fails if choose returns
      an illegal move, say returns no text, the learner makes fewer than 3 moves, the learner skips a part of the
      turn that is not marked sometimes, or an opponent never moves (unless the game ends during the tutorial).
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
  Required, for the move log and the tutorial:
  describeMove(state, move): short text for the move log, hints, and coach, written to follow the player's name,
    e.g. "rolled 8 and bought Oak Street". It must only reveal public information (say "drew a card", not which card).
  explainTurn(state, player): one or two plain sentences (under 300 characters) telling `player` what to decide
    right now and how to do it in this view, e.g. "Choose a column to drop your disc. You can block Yellow's three
    in a row by playing column 4." Mention the current phase, the options, and anything urgent (a threat, a target
    number, cards left). In hidden-information games `state` is engine.observe(state, player) (hidden parts are null),
    so only use what that player can see. It is called on every turn while the Coach is on, so keep it fast.

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
    quickStart: ["Goal: ...", "On your turn: ...", "Remember: ...", "The game ends when ..."],
    turnPhases: [
      { id: "...", name: "...", how: "Click ... to ... ." },
      { id: "...", name: "...", how: "...", sometimes: true },
    ],
    turnPhase(state) { return state.phase; },
    tutorial: {
      intro: "...",
      steps: [
        { choose: (state, moves) => moves[0], say: (state, move) => "Click ... to ... . This helps because ..." },
        { choose: (state, moves) => moves[0], say: (state, move) => "Now your opponent ... . Press Next to see it." },
        /* ... at least 3 moves by player 1 ... */
      ],
      outro: "You win by ... . Tip: ... .",
    },
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
    explainTurn(state, player) { /* ... */ },
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
