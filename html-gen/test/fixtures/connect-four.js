// Known-good game used by the tests: Connect Four in the game.js format.
(function () {
  const COLS = 7, ROWS = 6;
  const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

  // board[row][col], row 0 is the bottom. 0 = empty, 1/2 = player discs.
  function line(board, r, c) {
    const p = board[r][c];
    for (const [dc, dr] of DIRS) {
      const cells = [[r, c]];
      for (let n = 1; n < 4; n++) {
        const rr = r + dr * n, cc = c + dc * n;
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || board[rr][cc] !== p) break;
        cells.push([rr, cc]);
      }
      if (cells.length === 4) return cells;
    }
    return null;
  }

  function winningLine(board) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) if (board[r][c] && line(board, r, c)) return line(board, r, c);
    }
    return null;
  }

  function result(state) {
    const win = winningLine(state.board);
    if (win) return { winner: state.board[win[0][0]][win[0][1]] };
    if (state.board[ROWS - 1].every((v) => v !== 0)) return { winner: null };
    return null;
  }

  // Columns where `who` would complete four in a row right now.
  function winningColumns(state, who) {
    const cols = [];
    for (let c = 0; c < COLS; c++) {
      const r = state.board.findIndex((row) => row[c] === 0);
      if (r === -1 || result(state)) continue;
      const board = state.board.map((row) => row.slice());
      board[r][c] = who;
      if (result({ board })?.winner === who) cols.push(c);
    }
    return cols;
  }
  const col = (c) => `column ${c + 1}`;
  // Yellow's tutorial rule: win if possible, else block Red, else stack on the middle.
  const yellowChoice = (state, moves) => winningColumns(state, 2)[0] ?? winningColumns(state, 1)[0] ??
    (moves.includes(3) ? 3 : moves.includes(2) ? 2 : moves[0]);

  window.GameEngine = {
    name: "Connect Four",
    players: 2,
    playerNames: ["Red", "Yellow"],
    playerColors: ["#e5484d", "#f5c518"],
    rules: "Drop a disc into one of the seven columns; it falls to the lowest empty space.\n" +
      "Line up four of your discs horizontally, vertically, or diagonally to win.\nA full board is a draw.",
    quickStart: [
      "Goal: get four of your discs in a row: across, up and down, or diagonally.",
      "On your turn, click a column to drop a disc; it falls to the lowest empty space.",
      "Watch your opponent's lines too: block them before they reach four.",
      "If the board fills up with no four in a row, the game is a draw.",
    ],
    turnPhases: [
      { id: "drop", name: "Drop a disc",
        how: "Click any column that still has room. Your disc falls to the lowest empty space, then it's your opponent's turn." },
    ],
    turnPhase: () => "drop",
    tutorial: {
      intro: "You are Red and you move first. Yellow is the computer.",
      steps: [
        { choose: () => 3,
          say: () => "Click the glowing middle column (column 4) to drop your first disc. The middle is the strongest " +
            "spot because more lines of four pass through it than through any other column." },
        { choose: yellowChoice, say: () => "Now Yellow drops a disc. Press Next to see where it goes." },
        { say: (state) => {
          const c = [0, 1, 2, 3, 4, 5, 6].find((x) => state.board.some((row) => row[x] === 2));
          return "Discs stack up: each one falls to the lowest empty space in its column. " +
            `Yellow's disc went into ${col(c)}${c === 3 ? ", right on top of yours" : ""}.`;
        } },
        { choose: (state, moves) => (moves.includes(2) ? 2 : moves[0]),
          say: (state, move) => `Click ${col(move)}. Your disc lands next to your first one, making two in a row along the bottom.` },
        { choose: yellowChoice, say: () => "Yellow's turn again. Press Next." },
        { choose: (state, moves) => winningColumns(state, 1)[0] ?? (moves.includes(4) ? 4 : moves[0]),
          say: (state, move) => winningColumns(state, 1).includes(move)
            ? `Click ${col(move)} to complete four in a row and win!`
            : `Click ${col(move)}. That makes three red discs in a row with open space at both ends, so Yellow can only block one side.` },
        { choose: yellowChoice, say: () => "Yellow has to stop your line. Press Next to see which end it blocks." },
        { choose: (state, moves) => winningColumns(state, 1)[0] ?? moves[0],
          say: (state, move) => winningColumns(state, 1).includes(move)
            ? `Yellow could only block one end. Click ${col(move)} to complete four in a row and win!`
            : `Click ${col(move)} to keep building.` },
      ],
      outro: "You win by lining up four discs in any direction. Tip: build lines with open space at both ends, " +
        "and before every move check whether your opponent already has three in a row.",
    },
    initialState() {
      return { board: Array.from({ length: ROWS }, () => Array(COLS).fill(0)), turn: 1 };
    },
    currentPlayer(state) {
      return state.turn;
    },
    legalMoves(state) {
      if (result(state)) return [];
      const moves = [];
      for (let c = 0; c < COLS; c++) if (state.board[ROWS - 1][c] === 0) moves.push(c);
      return moves;
    },
    applyMove(state, col) {
      const board = state.board.map((row) => row.slice());
      board[board.findIndex((row) => row[col] === 0)][col] = state.turn;
      return { board, turn: 3 - state.turn };
    },
    result,
    describeMove(state, col) {
      return `dropped a disc in column ${col + 1}`;
    },
    explainTurn(state, player) {
      const names = this.playerNames;
      const winsFor = (who) => this.legalMoves(state).filter((col) => {
        const next = this.applyMove({ ...state, turn: who }, col);
        return result(next)?.winner === who;
      });
      const win = winsFor(player), threat = winsFor(3 - player);
      if (win.length) return `You can win right now: drop a disc in column ${win[0] + 1}.`;
      if (threat.length) return `${names[2 - player]} will win in column ${threat[0] + 1} next turn unless you block it there.`;
      return "Click a column to drop a disc. Build toward four in a row and keep an eye on your opponent's lines.";
    },
  };

  const SVG = "http://www.w3.org/2000/svg";
  const el = (tag, attrs) => {
    const node = document.createElementNS(SVG, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  };

  window.GameView = {
    mount(container, ctx) {
      const style = document.createElement("style");
      style.textContent = `
        .c4 { width: 100%; }
        .c4 .col { cursor: pointer; }
        .c4 .col:hover .hole { fill: #dbe4ff; }
        .c4 .disc { transition: transform .2s ease-out; }
        .c4 .win { stroke: #fff; stroke-width: 6; }`;
      container.appendChild(style);
      const svg = el("svg", { viewBox: `0 0 ${COLS * 100} ${ROWS * 100}`, width: "100%", class: "c4" });
      container.appendChild(svg);

      return {
        update(state, info) {
          svg.innerHTML = "";
          svg.appendChild(el("rect", { width: COLS * 100, height: ROWS * 100, rx: 24, fill: "#2a5bd7" }));
          const win = winningLine(state.board) || [];
          for (let c = 0; c < COLS; c++) {
            const col = el("g", { class: "col" });
            for (let r = 0; r < ROWS; r++) {
              const v = state.board[r][c];
              const isWin = win.some(([wr, wc]) => wr === r && wc === c);
              col.appendChild(el("circle", {
                cx: c * 100 + 50, cy: (ROWS - 1 - r) * 100 + 50, r: 40,
                fill: v ? ctx.colors[v - 1] : "#f5f7ff",
                class: v ? "disc" + (isWin ? " win" : "") : "hole",
              }));
            }
            col.addEventListener("click", () => {
              if (info.canMove && info.legalMoves.includes(c)) ctx.play(c);
            });
            svg.appendChild(col);
          }
        },
      };
    },
  };
})();
