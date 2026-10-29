// Known-good hidden-information game used by the tests: Crazy Eights for 2-4 players.
(function () {
  const K = window.GameKit;
  const MOVE_LIMIT = 400;

  const top = (state) => state.discard[state.discard.length - 1];
  const next = (state) => (state.turn % state.n) + 1;

  function result(state) {
    const empty = state.hands.findIndex((h) => h.length === 0);
    if (empty >= 0) return { winner: empty + 1 };
    // Blocked (everyone passed) or too long: fewest cards wins, ties share the win.
    if (state.passes >= state.n || state.moves >= MOVE_LIMIT) {
      const fewest = Math.min(...state.hands.map((h) => h.length));
      const winners = state.hands.map((h, i) => (h.length === fewest ? i + 1 : 0)).filter(Boolean);
      return { winners, scores: state.hands.map((h) => h.length) };
    }
    return null;
  }

  window.GameEngine = {
    name: "Crazy Eights",
    minPlayers: 2,
    maxPlayers: 4,
    players: 2,
    playerNames: ["North", "East", "South", "West"],
    playerColors: ["#e5484d", "#3b6fd8", "#2fa36b", "#f5b400"],
    hidden: true,
    rules: "Each player gets 5 cards. On your turn play a card matching the suit or rank of the top card.\n" +
      "Eights are wild: play one and name the next suit.\nIf you cannot play, draw one card and your turn ends.\n" +
      "First to empty their hand wins. If play is blocked, the fewest cards wins.",
    initialState(n = 2) {
      let [deck, seed] = K.shuffle(K.standardDeck(), K.newSeed());
      const hands = Array.from({ length: n }, (_, i) => deck.slice(i * 5, i * 5 + 5));
      deck = deck.slice(n * 5);
      const first = deck.pop();
      return { n, hands, deck, discard: [first], suit: K.cardSuit(first), turn: 1, passes: 0, moves: 0, seed };
    },
    currentPlayer(state) {
      return state.turn;
    },
    legalMoves(state) {
      if (result(state)) return [];
      const t = top(state);
      const moves = [];
      for (const c of state.hands[state.turn - 1]) {
        if (K.cardRank(c) === 8) for (const suit of Object.keys(K.SUITS)) moves.push({ play: c, suit });
        else if (K.cardSuit(c) === state.suit || K.cardRank(c) === K.cardRank(t)) moves.push({ play: c });
      }
      if (moves.length) return moves;
      return state.deck.length || state.discard.length > 1 ? [{ draw: true }] : [{ pass: true }];
    },
    applyMove(state, move) {
      const hands = state.hands.map((h) => h.slice());
      let { deck, discard, suit, passes, seed } = state;
      deck = deck.slice();
      discard = discard.slice();
      const hand = hands[state.turn - 1];
      if (move.play) {
        hand.splice(hand.indexOf(move.play), 1);
        discard.push(move.play);
        suit = move.suit || K.cardSuit(move.play);
        passes = 0;
      } else if (move.draw) {
        if (!deck.length) {
          // Reshuffle everything but the top card into a new deck.
          [deck, seed] = K.shuffle(discard.slice(0, -1), seed);
          discard = discard.slice(-1);
        }
        hand.push(deck.pop());
        passes = 0;
      } else {
        passes++;
      }
      return { ...state, hands, deck, discard, suit, passes, seed, moves: state.moves + 1, turn: next(state) };
    },
    result,
    observe(state, player) {
      return {
        ...state,
        hands: state.hands.map((h, i) => (i === player - 1 ? h : h.map(() => null))),
        deck: state.deck.map(() => null),
        seed: 0,
      };
    },
    determinize(state, player) {
      const unknown = state.deck.concat(...state.hands.filter((_, i) => i !== player - 1));
      let [cards, seed] = K.shuffle(unknown, K.newSeed());
      const hands = state.hands.map((h, i) => (i === player - 1 ? h : cards.splice(0, h.length)));
      return { ...state, hands, deck: cards, seed };
    },
    evaluate(state) {
      const scores = state.hands.map((h) => 1 / (1 + h.length));
      const total = scores.reduce((a, b) => a + b, 0);
      return scores.map((s) => s / total);
    },
    describeMove(state, move) {
      if (move.play) return `played ${K.cardLabel(move.play)}` + (move.suit ? ` and called ${K.SUITS[move.suit]}` : "");
      return move.draw ? "drew a card" : "passed";
    },
  };

  window.GameView = {
    mount(container, ctx) {
      const style = document.createElement("style");
      style.textContent = `
        .c8 { width: 100%; display: flex; flex-direction: column; gap: 14px; padding: 16px; border-radius: 16px;
              background: radial-gradient(circle at 50% 40%, #1f7a4d, #0f4a2e); color: #fff; }
        .c8 .hand { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .c8 .name { width: 70px; font-weight: 600; }
        .c8 .cards { display: flex; flex-wrap: wrap; }
        .c8 .cards > * { margin-right: -22px; transition: transform .15s; }
        .c8 .cards .playable { cursor: pointer; }
        .c8 .cards .playable:hover { transform: translateY(-8px); }
        .c8 .table { display: flex; justify-content: center; align-items: center; gap: 24px; padding: 8px 0; }
        .c8 .suit { font-size: 2rem; }
        .c8 .actions { display: flex; gap: 8px; justify-content: center; min-height: 40px; }
        .c8 .actions button { flex: none; background: #fff; color: #0f4a2e; border: 0; font-weight: 600; }`;
      container.appendChild(style);
      const root = document.createElement("div");
      root.className = "c8";
      container.appendChild(root);
      let last = null, choosing = null;

      function draw() {
        const [state, info] = last;
        const mine = info.viewer ?? info.player ?? 1;
        const playable = new Set(info.canMove ? info.legalMoves.filter((m) => m.play).map((m) => m.play) : []);
        root.innerHTML = "";
        const order = Array.from({ length: state.n }, (_, i) => ((mine - 1 + 1 + i) % state.n) + 1); // me last
        for (const p of order) {
          const row = document.createElement("div");
          row.className = "hand";
          row.innerHTML = `<span class="name" style="color:${ctx.colors[p - 1]}">${ctx.names[p - 1]}</span>`;
          const cards = document.createElement("div");
          cards.className = "cards";
          for (const c of state.hands[p - 1]) {
            const span = document.createElement("span");
            span.innerHTML = K.cardSVG(c, { width: p === mine ? 64 : 40, faceDown: !c, highlight: !!c && c === choosing });
            if (c && playable.has(c)) {
              span.className = "playable";
              span.addEventListener("click", () => {
                if (K.cardRank(c) === 8) { choosing = c; draw(); } else ctx.play({ play: c });
              });
            }
            cards.appendChild(span);
          }
          row.appendChild(cards);
          if (p === mine) root.appendChild(tableRow(state));
          root.appendChild(row);
        }
        const actions = document.createElement("div");
        actions.className = "actions";
        const buttons = choosing
          ? Object.keys(K.SUITS).map((suit) => [`${K.SUITS[suit]}`, { play: choosing, suit }])
          : info.legalMoves.filter((m) => !m.play).map((m) => [m.draw ? "Draw a card" : "Pass", m]);
        for (const [label, move] of info.canMove ? buttons : []) {
          const b = document.createElement("button");
          b.textContent = label;
          b.addEventListener("click", () => ctx.play(move));
          actions.appendChild(b);
        }
        root.appendChild(actions);
      }

      function tableRow(state) {
        const table = document.createElement("div");
        table.className = "table";
        table.innerHTML = `<span title="${state.deck.length} cards">${K.cardSVG(null, { width: 70, faceDown: true })}</span>` +
          K.cardSVG(state.discard[state.discard.length - 1], { width: 70 }) +
          `<span class="suit">${K.SUITS[state.suit]}</span>`;
        return table;
      }

      return {
        update(state, info) {
          last = [state, info];
          choosing = null;
          draw();
        },
      };
    },
  };
})();
