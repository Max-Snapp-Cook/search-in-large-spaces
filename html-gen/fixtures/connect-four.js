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

  window.GameEngine = {
    name: "Connect Four",
    players: 2,
    playerNames: ["Red", "Yellow"],
    playerColors: ["#e5484d", "#f5c518"],
    rules: "Drop a disc into one of the seven columns; it falls to the lowest empty space.\n" +
      "Line up four of your discs horizontally, vertically, or diagonally to win.\nA full board is a draw.",
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
