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

  // Tutorial rule for any player: play a matching ordinary card, else an eight naming the suit they hold
  // most of, else draw (or pass). Works for any deal.
  function tutorialChoice(state, moves) {
    const plain = moves.find((m) => m.play && K.cardRank(m.play) !== 8);
    if (plain) return plain;
    const eights = moves.filter((m) => m.play);
    if (eights.length) {
      const hand = state.hands[state.turn - 1].filter((c) => K.cardRank(c) !== 8);
      const count = (suit) => hand.filter((c) => K.cardSuit(c) === suit).length;
      return eights.reduce((best, m) => (count(m.suit) > count(best.suit) ? m : best));
    }
    return moves[0];
  }
  const needs = (state) => {
    const rank = K.cardLabel(top(state)).slice(0, -1);
    return `${K.SUITS[state.suit]} or ${/^(8|A)$/.test(rank) ? "an" : "a"} ${rank}`;
  };
  function learnerSays(state, move) {
    const topCard = K.cardLabel(top(state));
    if (move.play && K.cardRank(move.play) !== 8) {
      const how = K.cardSuit(move.play) === state.suit ? `same suit (${K.SUITS[state.suit]})` : "same rank";
      return `The top card is ${topCard}, so you need ${needs(state)}. Click your ${K.cardLabel(move.play)}: it has the ${how}, ` +
        "so it can go on the pile, and you are one card closer to an empty hand.";
    }
    if (move.play) {
      return `None of your ordinary cards match ${needs(state)}, but eights are wild. Click your ${K.cardLabel(move.play)}, ` +
        `then click ${K.SUITS[move.suit]}: you choose the next suit, so pick the one you hold the most of.`;
    }
    if (move.draw) return `Nothing in your hand matches ${needs(state)}. Click "Draw a card": you take one card and your turn ends.`;
    return "Nothing matches and the deck is empty, so click Pass.";
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
    quickStart: [
      "Goal: be the first to get rid of all your cards.",
      "On your turn, play a card that matches the suit or the rank of the top card of the pile.",
      "Eights are wild: play one any time and choose the suit the next player must follow.",
      "If you have nothing to play, draw a card. If nobody can play, the fewest cards wins.",
    ],
    // One decision per turn: play a matching card, or draw when nothing matches.
    turnPhases: [
      { id: "play", name: "Play or draw",
        how: "Click a card with the same suit or rank as the top card (for an eight, then click a suit). If nothing matches, click Draw a card." },
    ],
    turnPhase: () => "play",
    tutorial: {
      intro: "You are North, at the bottom of the table. East is the computer; you can see your own cards but not theirs.",
      steps: [
        { choose: tutorialChoice, say: learnerSays },
        { choose: tutorialChoice, say: (state) => `East's turn. They also need ${needs(state)}, or they must draw. Press Next to see what they do.` },
        { say: (state) => `East has ${state.hands[1].length} cards left and you have ${state.hands[0].length}. ` +
            "You can count their cards but not see them. Whoever empties their hand first wins." },
        { choose: tutorialChoice, say: learnerSays },
        { choose: tutorialChoice, say: (state) => `East plays next and needs ${needs(state)}. Press Next.` },
        { choose: tutorialChoice, say: learnerSays },
      ],
      outro: "You win by getting rid of all your cards first. Tip: hold on to your eights until nothing else matches, " +
        "and when you play one, name the suit you have the most of.",
    },
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
    // state is what `player` can see: their own hand, the pile, and everyone's hand sizes.
    explainTurn(state, player) {
      const t = top(state);
      const rank = K.cardLabel(t).slice(0, -1);
      const target = `${K.SUITS[state.suit]} or ${/^(8|A)$/.test(rank) ? "an" : "a"} ${rank}`;
      if (player !== state.turn) return `Waiting for ${this.playerNames[state.turn - 1]}. The pile needs ${target}.`;
      const moves = this.legalMoves(state);
      if (moves[0]?.draw) return `Nothing in your hand matches ${target}, so draw a card.`;
      if (moves[0]?.pass) return "Nothing matches and the deck is empty, so you must pass.";
      const playable = new Set(moves.map((m) => m.play)).size;
      const fewest = Math.min(...state.hands.filter((_, i) => i !== player - 1).map((h) => h.length));
      return `Play a card matching ${target} (eights are wild). You have ${playable} playable ` +
        `card${playable === 1 ? "" : "s"}; the closest opponent has ${fewest} left.`;
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
