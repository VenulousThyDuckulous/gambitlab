/*
 * GambitLab engine
 * A dependency-free chess rules engine, evaluator and alpha-beta searcher.
 * Board: 0x88 (128 squares, index 0 = a8, 112 = a1).
 * Pieces: 0 empty, 1-6 white P/N/B/R/Q/K, 9-14 black P/N/B/R/Q/K.
 */

export const WHITE = 0;
export const BLACK = 1;

export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

export const MATE = 100000;
const INF = 1000000;

export const FLAG_NORMAL = 0;
export const FLAG_CAPTURE = 1;
export const FLAG_DOUBLE = 2;
export const FLAG_EP = 3;
export const FLAG_CASTLE = 4;
export const FLAG_PROMO = 5;
export const FLAG_PROMO_CAPTURE = 6;

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const FILES = 'abcdefgh';
const PIECE_LETTERS = ' pnbrqk';

const KNIGHT_OFFSETS = [-33, -31, -18, -14, 14, 18, 31, 33];
const BISHOP_DIRS = [-17, -15, 15, 17];
const ROOK_DIRS = [-16, -1, 1, 16];
const KING_DIRS = [-17, -16, -15, -1, 1, 15, 16, 17];

const SQUARES = [];
for (let row = 0; row < 8; row++) {
  for (let file = 0; file < 8; file++) SQUARES.push(row * 16 + file);
}

const CASTLE_MASK = new Int8Array(128).fill(15);
CASTLE_MASK[116] = 12; // e1
CASTLE_MASK[119] = 14; // h1
CASTLE_MASK[112] = 13; // a1
CASTLE_MASK[4] = 3;    // e8
CASTLE_MASK[7] = 11;   // h8
CASTLE_MASK[0] = 7;    // a8

const VALUES = { 1: 100, 2: 320, 3: 330, 4: 500, 5: 900, 6: 0 };

// Piece-square tables are written with rank 8 first (index 0 = a8).
const PST = {
  1: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  2: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  3: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  4: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  5: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  6: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ],
};

const KING_END = [
  -50, -40, -30, -20, -20, -30, -40, -50,
  -30, -20, -10, 0, 0, -10, -20, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -30, 0, 0, 0, 0, -30, -30,
  -50, -30, -30, -30, -30, -30, -30, -50,
];

export function colorOf(piece) {
  return piece >> 3;
}

export function typeOf(piece) {
  return piece & 7;
}

export function squareName(sq) {
  return FILES[sq & 7] + (8 - (sq >> 4));
}

export function parseSquare(name) {
  const file = FILES.indexOf(name[0]);
  const rank = Number(name[1]);
  if (file < 0 || rank < 1 || rank > 8) return -1;
  return (8 - rank) * 16 + file;
}

export function moveFrom(move) { return move & 127; }
export function moveTo(move) { return (move >> 7) & 127; }
export function movePromo(move) { return (move >> 14) & 7; }
export function moveFlag(move) { return (move >> 17) & 7; }

export function makeMoveInt(from, to, promo = 0, flag = FLAG_NORMAL) {
  return from | (to << 7) | (promo << 14) | (flag << 17);
}

export function moveToUci(move) {
  const promo = movePromo(move);
  return squareName(moveFrom(move)) + squareName(moveTo(move)) + (promo ? ' nbrq'[promo] : '').trim();
}

function pstIndex(sq, color) {
  const row = sq >> 4;
  const file = sq & 7;
  return color === WHITE ? row * 8 + file : (7 - row) * 8 + file;
}

export class Position {
  constructor(fen = START_FEN) {
    this.board = new Int8Array(128);
    this.turn = WHITE;
    this.castling = 0;
    this.ep = -1;
    this.halfmove = 0;
    this.fullmove = 1;
    this.kingSq = [-1, -1];
    this.histMoves = [];
    this.histCaptured = [];
    this.histCastling = [];
    this.histEp = [];
    this.histHalf = [];
    this.loadFen(fen);
  }

  loadFen(fen) {
    const parts = fen.trim().split(/\s+/);
    this.board.fill(0);
    this.kingSq = [-1, -1];
    this.histMoves.length = 0;
    this.histCaptured.length = 0;
    this.histCastling.length = 0;
    this.histEp.length = 0;
    this.histHalf.length = 0;

    let row = 0;
    let file = 0;
    for (const ch of parts[0]) {
      if (ch === '/') {
        row++;
        file = 0;
      } else if (ch >= '1' && ch <= '8') {
        file += Number(ch);
      } else {
        const lower = ch.toLowerCase();
        const type = PIECE_LETTERS.indexOf(lower);
        if (type > 0) {
          const color = ch === lower ? BLACK : WHITE;
          const sq = row * 16 + file;
          this.board[sq] = type | (color << 3);
          if (type === KING) this.kingSq[color] = sq;
        }
        file++;
      }
    }

    this.turn = parts[1] === 'b' ? BLACK : WHITE;
    this.castling = 0;
    const rights = parts[2] || '-';
    if (rights.includes('K')) this.castling |= 1;
    if (rights.includes('Q')) this.castling |= 2;
    if (rights.includes('k')) this.castling |= 4;
    if (rights.includes('q')) this.castling |= 8;
    this.ep = parts[3] && parts[3] !== '-' ? parseSquare(parts[3]) : -1;
    this.halfmove = Number(parts[4] || 0) || 0;
    this.fullmove = Number(parts[5] || 1) || 1;
    return this;
  }

  fen() {
    let placement = '';
    for (let row = 0; row < 8; row++) {
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const piece = this.board[row * 16 + file];
        if (!piece) {
          empty++;
          continue;
        }
        if (empty) {
          placement += empty;
          empty = 0;
        }
        const letter = PIECE_LETTERS[piece & 7];
        placement += (piece >> 3) === WHITE ? letter.toUpperCase() : letter;
      }
      if (empty) placement += empty;
      if (row < 7) placement += '/';
    }
    let rights = '';
    if (this.castling & 1) rights += 'K';
    if (this.castling & 2) rights += 'Q';
    if (this.castling & 4) rights += 'k';
    if (this.castling & 8) rights += 'q';
    return [
      placement,
      this.turn === WHITE ? 'w' : 'b',
      rights || '-',
      this.ep >= 0 ? squareName(this.ep) : '-',
      this.halfmove,
      this.fullmove,
    ].join(' ');
  }

  /** FEN fields that define repetition (en passant only when it changes the position). */
  positionKey() {
    const parts = this.fen().split(' ');
    if (parts[3] !== '-') {
      let canCapture = false;
      const color = this.turn;
      const dir = color === WHITE ? -16 : 16;
      for (const delta of [-1, 1]) {
        const from = this.ep - dir + delta;
        if (from & 0x88) continue;
        if (this.board[from] === (PAWN | (color << 3))) canCapture = true;
      }
      if (!canCapture) parts[3] = '-';
    }
    return parts.slice(0, 4).join(' ');
  }

  pieceAt(sq) {
    return this.board[sq];
  }

  colorAt(sq) {
    const piece = this.board[sq];
    return piece ? piece >> 3 : -1;
  }

  inCheck(color = this.turn) {
    return this.isAttacked(this.kingSq[color], 1 - color);
  }

  isAttacked(sq, by) {
    const board = this.board;
    if (sq < 0) return false;

    // Pawns: a white pawn attacking sq sits one rank below it.
    if (by === WHITE) {
      if (!((sq + 15) & 0x88) && board[sq + 15] === PAWN) return true;
      if (!((sq + 17) & 0x88) && board[sq + 17] === PAWN) return true;
    } else {
      if (!((sq - 15) & 0x88) && board[sq - 15] === (PAWN | 8)) return true;
      if (!((sq - 17) & 0x88) && board[sq - 17] === (PAWN | 8)) return true;
    }

    const knight = KNIGHT | (by << 3);
    for (const offset of KNIGHT_OFFSETS) {
      const target = sq + offset;
      if (!(target & 0x88) && board[target] === knight) return true;
    }

    const king = KING | (by << 3);
    for (const offset of KING_DIRS) {
      const target = sq + offset;
      if (!(target & 0x88) && board[target] === king) return true;
    }

    const queen = QUEEN | (by << 3);
    const rook = ROOK | (by << 3);
    const bishop = BISHOP | (by << 3);

    for (const dir of ROOK_DIRS) {
      let target = sq + dir;
      while (!(target & 0x88)) {
        const piece = board[target];
        if (piece) {
          if (piece === rook || piece === queen) return true;
          break;
        }
        target += dir;
      }
    }

    for (const dir of BISHOP_DIRS) {
      let target = sq + dir;
      while (!(target & 0x88)) {
        const piece = board[target];
        if (piece) {
          if (piece === bishop || piece === queen) return true;
          break;
        }
        target += dir;
      }
    }

    return false;
  }

  pseudoMoves(capturesOnly = false) {
    const moves = [];
    const board = this.board;
    const us = this.turn;
    const them = 1 - us;
    const pawn = PAWN | (us << 3);
    const king = KING | (us << 3);

    const pushPawn = (from, to, flag, captured = 0) => {
      const toRow = to >> 4;
      if (toRow === 0 || toRow === 7) {
        const promoFlag = captured ? FLAG_PROMO_CAPTURE : FLAG_PROMO;
        for (const promo of [QUEEN, ROOK, BISHOP, KNIGHT]) {
          moves.push(makeMoveInt(from, to, promo, promoFlag));
        }
      } else {
        moves.push(makeMoveInt(from, to, 0, captured ? FLAG_CAPTURE : flag));
      }
    };

    for (const from of SQUARES) {
      const piece = board[from];
      if (!piece || (piece >> 3) !== us) continue;
      const type = piece & 7;

      if (type === PAWN) {
        const dir = us === WHITE ? -16 : 16;
        const startRow = us === WHITE ? 6 : 1;
        const one = from + dir;
        if (!(one & 0x88) && !board[one]) {
          if (!capturesOnly || one >> 4 === 0 || one >> 4 === 7) {
            pushPawn(from, one, FLAG_NORMAL);
          }
          const two = one + dir;
          if (!capturesOnly && (from >> 4) === startRow && !(two & 0x88) && !board[two]) {
            moves.push(makeMoveInt(from, two, 0, FLAG_DOUBLE));
          }
        }
        for (const delta of [dir - 1, dir + 1]) {
          const to = from + delta;
          if (to & 0x88) continue;
          const target = board[to];
          if (target && (target >> 3) === them) {
            pushPawn(from, to, FLAG_CAPTURE, target);
          } else if (to === this.ep && !target) {
            const capSq = to + (us === WHITE ? 16 : -16);
            if (board[capSq] === (PAWN | (them << 3))) {
              moves.push(makeMoveInt(from, to, 0, FLAG_EP));
            }
          }
        }
        continue;
      }

      if (type === KNIGHT || type === KING) {
        const offsets = type === KNIGHT ? KNIGHT_OFFSETS : KING_DIRS;
        for (const offset of offsets) {
          const to = from + offset;
          if (to & 0x88) continue;
          const target = board[to];
          if (!target) {
            if (!capturesOnly) moves.push(makeMoveInt(from, to));
          } else if ((target >> 3) === them) {
            moves.push(makeMoveInt(from, to, 0, FLAG_CAPTURE));
          }
        }
        if (type === KING && !capturesOnly) {
          const home = us === WHITE ? 116 : 4;
          if (from === home) {
            const kSide = us === WHITE ? 1 : 4;
            const qSide = us === WHITE ? 2 : 8;
            const opp = them;
            if (
              (this.castling & kSide) &&
              !board[home + 1] && !board[home + 2] &&
              board[home + 3] === (ROOK | (us << 3)) &&
              !this.isAttacked(home, opp) &&
              !this.isAttacked(home + 1, opp) &&
              !this.isAttacked(home + 2, opp)
            ) {
              moves.push(makeMoveInt(home, home + 2, 0, FLAG_CASTLE));
            }
            if (
              (this.castling & qSide) &&
              !board[home - 1] && !board[home - 2] && !board[home - 3] &&
              board[home - 4] === (ROOK | (us << 3)) &&
              !this.isAttacked(home, opp) &&
              !this.isAttacked(home - 1, opp) &&
              !this.isAttacked(home - 2, opp)
            ) {
              moves.push(makeMoveInt(home, home - 2, 0, FLAG_CASTLE));
            }
          }
        }
        continue;
      }

      const directions = type === BISHOP ? BISHOP_DIRS : type === ROOK ? ROOK_DIRS : KING_DIRS;
      for (const dir of directions) {
        let to = from + dir;
        while (!(to & 0x88)) {
          const target = board[to];
          if (!target) {
            if (!capturesOnly) moves.push(makeMoveInt(from, to));
          } else {
            if ((target >> 3) === them) moves.push(makeMoveInt(from, to, 0, FLAG_CAPTURE));
            break;
          }
          to += dir;
        }
      }
    }

    return moves;
  }

  legalMoves(capturesOnly = false) {
    const moves = this.pseudoMoves(capturesOnly);
    const legal = [];
    for (const move of moves) {
      this.makeMove(move);
      if (!this.isAttacked(this.kingSq[1 - this.turn], this.turn)) legal.push(move);
      this.undoMove();
    }
    return legal;
  }

  makeMove(move) {
    const from = moveFrom(move);
    const to = moveTo(move);
    const promo = movePromo(move);
    const flag = moveFlag(move);
    const board = this.board;
    const us = this.turn;
    const piece = board[from];
    const type = piece & 7;
    const capturedSq = flag === FLAG_EP ? to + (us === WHITE ? 16 : -16) : to;
    const captured = board[capturedSq];

    this.histMoves.push(move);
    this.histCaptured.push(captured);
    this.histCastling.push(this.castling);
    this.histEp.push(this.ep);
    this.histHalf.push(this.halfmove);

    board[from] = 0;
    board[to] = promo ? promo | (us << 3) : piece;

    if (flag === FLAG_EP) board[capturedSq] = 0;

    if (flag === FLAG_CASTLE) {
      const rookFrom = to > from ? to + 1 : to - 2;
      const rookTo = to > from ? to - 1 : to + 1;
      board[rookTo] = board[rookFrom];
      board[rookFrom] = 0;
    }

    if (type === KING) this.kingSq[us] = to;

    this.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
    this.ep = flag === FLAG_DOUBLE ? from + (us === WHITE ? -16 : 16) : -1;
    this.halfmove = type === PAWN || captured ? 0 : this.halfmove + 1;
    this.turn = 1 - us;
    if (us === BLACK) this.fullmove++;
  }

  undoMove() {
    const move = this.histMoves.pop();
    if (move === undefined) return;
    const from = moveFrom(move);
    const to = moveTo(move);
    const promo = movePromo(move);
    const flag = moveFlag(move);
    const board = this.board;

    const us = 1 - this.turn;
    this.turn = us;
    if (us === BLACK) this.fullmove--;

    const captured = this.histCaptured.pop();
    this.halfmove = this.histHalf.pop();
    this.ep = this.histEp.pop();
    this.castling = this.histCastling.pop();

    let piece = board[to];
    board[to] = 0;
    if (promo) piece = PAWN | (us << 3);
    board[from] = piece;

    if (flag === FLAG_EP) {
      const capturedSq = to + (us === WHITE ? 16 : -16);
      board[capturedSq] = captured;
    } else if (captured) {
      board[to] = captured;
    }

    if (flag === FLAG_CASTLE) {
      const rookFrom = to > from ? to + 1 : to - 2;
      const rookTo = to > from ? to - 1 : to + 1;
      board[rookFrom] = board[rookTo];
      board[rookTo] = 0;
    }

    if ((piece & 7) === KING) this.kingSq[us] = from;
  }

  findMove(from, to, promo = 0) {
    for (const move of this.legalMoves()) {
      if (moveFrom(move) === from && moveTo(move) === to) {
        if (!promo || movePromo(move) === promo) return move;
        if (!movePromo(move)) return move;
      }
    }
    return null;
  }

  san(move) {
    const from = moveFrom(move);
    const to = moveTo(move);
    const promo = movePromo(move);
    const flag = moveFlag(move);
    const piece = this.board[from];
    const type = piece & 7;
    const isCapture = flag === FLAG_CAPTURE || flag === FLAG_EP || flag === FLAG_PROMO_CAPTURE;

    if (flag === FLAG_CASTLE) {
      return (to & 7) === 6 ? 'O-O' : 'O-O-O';
    }

    let san = '';
    if (type === PAWN) {
      if (isCapture) san += FILES[from & 7] + 'x';
      san += squareName(to);
      if (promo) san += '=' + PIECE_LETTERS[promo].toUpperCase();
    } else {
      san += PIECE_LETTERS[type].toUpperCase();
      const rivals = this.legalMoves().filter((other) => {
        if (other === move || moveTo(other) !== to) return false;
        const otherPiece = this.board[moveFrom(other)];
        return (otherPiece & 7) === type && (otherPiece >> 3) === this.turn;
      });
      if (rivals.length) {
        const sameFile = rivals.some((other) => (moveFrom(other) & 7) === (from & 7));
        const sameRank = rivals.some((other) => (moveFrom(other) >> 4) === (from >> 4));
        if (!sameFile) san += FILES[from & 7];
        else if (!sameRank) san += String(8 - (from >> 4));
        else san += squareName(from);
      }
      if (isCapture) san += 'x';
      san += squareName(to);
    }

    this.makeMove(move);
    if (this.inCheck()) san += this.legalMoves().length ? '+' : '#';
    this.undoMove();

    return san;
  }

  toUci(move) {
    return moveToUci(move);
  }
}

export function findMoveByUci(pos, uci) {
  for (const move of pos.legalMoves()) {
    if (moveToUci(move) === uci) return move;
  }
  return null;
}

export function perft(pos, depth) {
  if (depth === 0) return 1;
  const moves = pos.legalMoves();
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const move of moves) {
    pos.makeMove(move);
    nodes += perft(pos, depth - 1);
    pos.undoMove();
  }
  return nodes;
}

export function evaluate(pos) {
  const board = pos.board;
  let white = 0;
  let black = 0;
  let nonPawn = 0;
  let whiteBishops = 0;
  let blackBishops = 0;

  for (const sq of SQUARES) {
    const piece = board[sq];
    if (!piece) continue;
    const color = piece >> 3;
    const type = piece & 7;
    if (type === KING) continue;

    const value = VALUES[type] + PST[type][pstIndex(sq, color)];
    if (color === WHITE) white += value;
    else black += value;

    if (type !== PAWN) nonPawn += VALUES[type];
    if (type === BISHOP) {
      if (color === WHITE) whiteBishops++;
      else blackBishops++;
    }
  }

  const kingTable = nonPawn < 1800 ? KING_END : PST[KING];
  white += kingTable[pstIndex(pos.kingSq[WHITE], WHITE)];
  black += kingTable[pstIndex(pos.kingSq[BLACK], BLACK)];
  if (whiteBishops >= 2) white += 28;
  if (blackBishops >= 2) black += 28;

  const score = white - black + (pos.turn === WHITE ? 10 : -10);
  return pos.turn === WHITE ? score : -score;
}

function scoreMove(pos, move) {
  const flag = moveFlag(move);
  let score = 0;
  if (flag === FLAG_PROMO || flag === FLAG_PROMO_CAPTURE) score += 9000 + movePromo(move) * 10;
  if (flag === FLAG_CAPTURE || flag === FLAG_PROMO_CAPTURE || flag === FLAG_EP) {
    const victim = flag === FLAG_EP ? PAWN : pos.board[moveTo(move)] & 7;
    const attacker = pos.board[moveFrom(move)] & 7;
    score += 5000 + VALUES[victim] * 10 - VALUES[attacker];
  }
  if (flag === FLAG_CASTLE) score += 400;
  return score;
}

function orderMoves(pos, moves) {
  if (moves.length < 2) return;
  const scored = moves.map((move) => [scoreMove(pos, move), move]);
  scored.sort((a, b) => b[0] - a[0]);
  for (let i = 0; i < scored.length; i++) moves[i] = scored[i][1];
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function quiescence(pos, alpha, beta, ctx, qdepth = 0) {
  ctx.nodes++;
  if ((ctx.nodes & 1023) === 0 && now() > ctx.deadline) {
    ctx.aborted = true;
    return alpha;
  }

  const standPat = evaluate(pos);
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;
  if (qdepth >= 4) return alpha;

  const moves = pos.pseudoMoves(true);
  orderMoves(pos, moves);

  for (const move of moves) {
    pos.makeMove(move);
    if (pos.isAttacked(pos.kingSq[1 - pos.turn], pos.turn)) {
      pos.undoMove();
      continue;
    }
    const score = -quiescence(pos, -beta, -alpha, ctx, qdepth + 1);
    pos.undoMove();
    if (ctx.aborted) return alpha;
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }

  return alpha;
}

function negamax(pos, depth, alpha, beta, ply, ctx) {
  ctx.nodes++;
  if ((ctx.nodes & 1023) === 0 && now() > ctx.deadline) {
    ctx.aborted = true;
    return alpha;
  }

  if (depth <= 0) return quiescence(pos, alpha, beta, ctx);

  const moves = pos.legalMoves();
  if (!moves.length) return pos.inCheck() ? -MATE + ply : 0;
  orderMoves(pos, moves);

  for (const move of moves) {
    pos.makeMove(move);
    const score = -negamax(pos, depth - 1, -beta, -alpha, ply + 1, ctx);
    pos.undoMove();
    if (ctx.aborted) return alpha;
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }

  return alpha;
}

function rootSearch(pos, depth, ctx) {
  const moves = pos.legalMoves();
  orderMoves(pos, moves);
  let bestMove = moves[0];
  let bestScore = -INF;
  let alpha = -INF;

  for (const move of moves) {
    pos.makeMove(move);
    const score = -negamax(pos, depth - 1, -INF, -alpha, 1, ctx);
    pos.undoMove();
    if (ctx.aborted) break;
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
    if (score > alpha) alpha = score;
  }

  return { move: bestMove, score: bestScore };
}

/** Iterative-deepening alpha-beta search. Returns a move plus an evaluation from the mover's side. */
export function findBestMove(pos, maxDepth = 3, { timeLimit = 3000 } = {}) {
  const legal = pos.legalMoves();
  if (!legal.length) {
    return { move: null, score: pos.inCheck() ? -MATE : 0, depth: 0, nodes: 0 };
  }

  const ctx = { nodes: 0, deadline: now() + timeLimit, aborted: false };
  let best = { move: legal[0], score: -INF, depth: 0, nodes: 0 };

  for (let depth = 1; depth <= maxDepth; depth++) {
    const result = rootSearch(pos, depth, ctx);
    if (ctx.aborted) break;
    best = { move: result.move, score: result.score, depth, nodes: ctx.nodes };
    if (Math.abs(result.score) > MATE - 1000) break;
    if (now() > ctx.deadline) break;
  }

  return best;
}

/** Rank every legal move with a full-window search (used for human-like bot imperfection). */
export function searchRootMoves(pos, maxDepth = 2, { timeLimit = 900 } = {}) {
  const ctx = { nodes: 0, deadline: now() + timeLimit, aborted: false };
  const results = [];
  const moves = pos.legalMoves();
  orderMoves(pos, moves);

  for (const move of moves) {
    pos.makeMove(move);
    const score = -negamax(pos, Math.max(0, maxDepth - 1), -INF, INF, 1, ctx);
    pos.undoMove();
    if (ctx.aborted) break;
    results.push({ move, score });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

export function isInsufficientMaterial(pos) {
  const pieces = [];
  for (const sq of SQUARES) {
    const piece = pos.board[sq];
    if (!piece) continue;
    const type = piece & 7;
    if (type === KING) continue;
    pieces.push({ type, color: piece >> 3, sq });
  }
  if (pieces.length === 0) return true;
  if (pieces.length === 1 && (pieces[0].type === BISHOP || pieces[0].type === KNIGHT)) return true;
  if (pieces.length === 2 && pieces[0].type === BISHOP && pieces[1].type === BISHOP) {
    const colorA = (pieces[0].sq >> 4) + (pieces[0].sq & 7);
    const colorB = (pieces[1].sq >> 4) + (pieces[1].sq & 7);
    if (colorA % 2 === colorB % 2) return true;
  }
  return false;
}
