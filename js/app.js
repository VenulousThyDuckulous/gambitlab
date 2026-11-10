import {
  Position,
  WHITE,
  BLACK,
  KNIGHT,
  BISHOP,
  ROOK,
  QUEEN,
  START_FEN,
  FLAG_CAPTURE,
  FLAG_EP,
  FLAG_PROMO_CAPTURE,
  moveFrom,
  moveTo,
  movePromo,
  moveFlag,
  moveToUci,
  findMoveByUci,
  isInsufficientMaterial,
  squareName,
} from './engine.js';
import { BOTS, botById, chooseBotMove } from './bots.js';
import { buildMatchReport, CLASS_META } from './analysis.js';

const FILES = 'abcdefgh';
const GLYPHS = { 1: '♟', 2: '♞', 3: '♝', 4: '♜', 5: '♛', 6: '♚' };
const PIECE_NAMES = { 1: 'pawn', 2: 'knight', 3: 'bishop', 4: 'rook', 5: 'queen', 6: 'king' };
const PIECE_VALUES = { 1: 1, 2: 3, 3: 3, 4: 5, 5: 9, 6: 0 };
const START_COUNTS = { 1: 8, 2: 2, 3: 2, 4: 2, 5: 1, 6: 1 };

const state = {
  pos: new Position(),
  players: {
    white: { kind: 'human' },
    black: { kind: 'bot', bot: botById('casey') },
  },
  history: [],
  repetition: [],
  over: false,
  result: '*',
  reason: '',
  thinking: false,
  paused: false,
  selected: -1,
  legal: [],
  lastMove: null,
  flipped: false,
  reviewPly: null,
  gameId: 0,
  analysis: null,
  analysisDepth: 3,
  analysisRunning: false,
  analysisProgress: { done: 0, total: 0 },
  analysisWorker: null,
  analysisToken: 0,
  analysisError: null,
};

const els = {};

let botWorker = null;
let botSequence = 0;
const botPending = new Map();

function $(selector) {
  return document.querySelector(selector);
}

function playerFor(color) {
  return color === WHITE ? state.players.white : state.players.black;
}

function isHuman(color) {
  return playerFor(color).kind === 'human';
}

function bothBots() {
  return !isHuman(WHITE) && !isHuman(BLACK);
}

function playerName(color) {
  const player = playerFor(color);
  if (player.kind === 'human') return 'You';
  return player.bot.name;
}

function reportName(color) {
  const player = playerFor(color);
  if (player.kind === 'human') return `You (${color === WHITE ? 'White' : 'Black'})`;
  return `${player.bot.name} · ${player.bot.elo}`;
}

function resolvePlayer(value) {
  if (value === 'human') return { kind: 'human' };
  return { kind: 'bot', bot: botById(value) };
}

function initials(name) {
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0].toUpperCase()).join('');
}

function colorLetter(color) {
  return color === WHITE ? 'w' : 'b';
}

function otherColor(color) {
  return color === WHITE ? BLACK : WHITE;
}

function resultLabel(result) {
  if (result === '1-0') return 'White wins';
  if (result === '0-1') return 'Black wins';
  if (result === '1/2-1/2') return 'Draw';
  return 'In progress';
}

function turnFromHistory() {
  const last = state.history[state.history.length - 1];
  if (!last) return WHITE;
  return last.color === 'w' ? BLACK : WHITE;
}

function moveNumber(ply) {
  return Math.ceil(ply / 2);
}

function formatPawns(cp) {
  return (cp / 100).toFixed(2);
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function renderAll() {
  renderSeats();
  renderStatus();
  renderBoard();
  renderMoves();
  renderReviewBar();
  renderControls();
  renderAnalysis();
}

function renderSeats() {
  if (!els.seatTop) return;
  const topColor = state.flipped ? WHITE : BLACK;
  els.seatTop.innerHTML = seatHTML(topColor);
  els.seatBottom.innerHTML = seatHTML(otherColor(topColor));
}

function seatHTML(color) {
  const player = playerFor(color);
  const isBot = player.kind === 'bot';
  const bot = player.bot;
  const active = !state.over && state.pos.turn === color;
  const thinking = state.thinking && active;
  const name = isBot ? bot.name : 'You';
  const meta = isBot
    ? `Bot · depth ${bot.depth}`
    : `Human · ${bothBots() ? '' : 'local'}`;

  return `
    <div class="seat ${active ? 'active' : ''} ${thinking ? 'thinking' : ''}">
      <div class="seat-avatar ${isBot ? 'bot' : 'human'}">${isBot ? initials(name) : '♟'}</div>
      <div class="seat-copy">
        <div class="seat-name">${name}${isBot ? `<span class="elo-chip">${bot.elo}</span>` : ''}</div>
        <div class="seat-meta">${thinking ? 'thinking<span class="dots">…</span>' : meta}</div>
      </div>
      <div class="seat-captured">${capturedHTML(color)}</div>
      <span class="turn-dot ${active ? 'on' : ''}" aria-hidden="true"></span>
    </div>`;
}

function capturedHTML(color) {
  const opponent = otherColor(color);
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (let row = 0; row < 8; row++) {
    for (let file = 0; file < 8; file++) {
      const piece = state.pos.board[row * 16 + file];
      if (piece && (piece >> 3) === opponent) counts[piece & 7]++;
    }
  }

  let glyphs = '';
  for (const type of [5, 4, 3, 2, 1]) {
    const missing = Math.max(0, START_COUNTS[type] - counts[type]);
    for (let i = 0; i < missing; i++) {
      glyphs += `<span class="mini ${opponent === WHITE ? 'white' : 'black'}">${GLYPHS[type]}</span>`;
    }
  }

  const diff = captureValue(color) - captureValue(opponent);
  return `${glyphs}${diff > 0 ? `<span class="mat-plus">+${diff}</span>` : ''}`;
}

function captureValue(color) {
  const opponent = otherColor(color);
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (let row = 0; row < 8; row++) {
    for (let file = 0; file < 8; file++) {
      const piece = state.pos.board[row * 16 + file];
      if (piece && (piece >> 3) === opponent) counts[piece & 7]++;
    }
  }
  let value = 0;
  for (const type of [1, 2, 3, 4, 5]) {
    value += Math.max(0, START_COUNTS[type] - counts[type]) * PIECE_VALUES[type];
  }
  return value;
}

function renderStatus() {
  if (!els.statusText) return;
  let text;
  if (state.over) {
    text = `${state.reason} · ${resultLabel(state.result)}`;
  } else if (state.reviewPly !== null) {
    text = `Reviewing move ${state.reviewPly} of ${state.history.length}`;
  } else if (state.thinking) {
    text = `${playerName(state.pos.turn)} is thinking…`;
  } else {
    const color = state.pos.turn;
    text = `${color === WHITE ? 'White' : 'Black'} to move${isHuman(color) ? ' · your move' : ''}`;
  }
  els.statusText.textContent = text;
  els.statusDot.className = `status-dot ${state.thinking ? 'thinking' : ''} ${state.over ? 'over' : ''}`;
}

function viewPosition() {
  if (state.reviewPly === null) {
    return { pos: state.pos, lastMove: state.lastMove };
  }
  const first = state.history[0];
  const fen = state.reviewPly === 0
    ? (first ? first.fenBefore : START_FEN)
    : state.history[state.reviewPly - 1].fenAfter;
  const rec = state.reviewPly > 0 ? state.history[state.reviewPly - 1] : null;
  return {
    pos: new Position(fen),
    lastMove: rec ? { from: rec.from, to: rec.to } : null,
  };
}

function renderBoard() {
  const { pos, lastMove } = viewPosition();
  const reviewing = state.reviewPly !== null;
  const selected = reviewing ? -1 : state.selected;
  const targets = new Map();

  if (selected >= 0) {
    for (const move of state.legal) {
      if (moveFrom(move) !== selected) continue;
      const flag = moveFlag(move);
      const capture = flag === FLAG_CAPTURE || flag === FLAG_EP || flag === FLAG_PROMO_CAPTURE;
      targets.set(moveTo(move), capture ? 2 : 1);
    }
  }

  const checkSq = pos.inCheck() ? pos.kingSq[pos.turn] : -1;
  let html = '';

  for (let visualRow = 0; visualRow < 8; visualRow++) {
    for (let visualFile = 0; visualFile < 8; visualFile++) {
      const row = state.flipped ? 7 - visualRow : visualRow;
      const file = state.flipped ? 7 - visualFile : visualFile;
      const sq = row * 16 + file;
      const light = (row + file) % 2 === 0;
      const piece = pos.board[sq];
      const classes = ['sq', light ? 'light' : 'dark'];

      if (sq === selected) classes.push('selected');
      if (lastMove && (sq === lastMove.from || sq === lastMove.to)) classes.push('last');
      if (sq === checkSq) classes.push('check');
      const target = targets.get(sq);
      if (target === 2) classes.push('hint-capture');
      else if (target === 1) classes.push('hint');

      let inner = '';
      if (visualFile === 0) inner += `<span class="coord rank">${8 - row}</span>`;
      if (visualRow === 7) inner += `<span class="coord file">${FILES[file]}</span>`;
      if (piece) {
        inner += `<span class="piece ${piece >> 3 === WHITE ? 'white' : 'black'}" aria-hidden="true">${GLYPHS[piece & 7]}</span>`;
      }

      const label = `${squareName(sq)}${piece ? `, ${piece >> 3 === WHITE ? 'white' : 'black'} ${PIECE_NAMES[piece & 7]}` : ''}`;
      html += `<div class="${classes.join(' ')}" data-sq="${sq}" role="button" aria-label="${label}">${inner}</div>`;
    }
  }

  els.board.innerHTML = html;
  els.board.classList.toggle('reviewing', reviewing);
}

function renderMoves() {
  if (!els.moves) return;
  if (!state.history.length) {
    els.moves.innerHTML = `<p class="empty-moves">The board is set. Make a move.</p>`;
    return;
  }

  const reportMoves = state.analysis?.moves || [];
  const currentPly = state.reviewPly === null ? state.history.length : state.reviewPly;
  let html = '';

  for (let i = 0; i < state.history.length; i += 2) {
    const number = i / 2 + 1;
    const whiteMove = state.history[i];
    const blackMove = state.history[i + 1];
    html += `<div class="move-row"><span class="move-num">${number}</span>`;
    html += moveButton(whiteMove, i + 1, currentPly, reportMoves[i]);
    if (blackMove) {
      html += moveButton(blackMove, i + 2, currentPly, reportMoves[i + 1]);
    } else {
      html += '<span></span>';
    }
    html += '</div>';
  }

  els.moves.innerHTML = html;
  const active = els.moves.querySelector('.move-btn.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function moveButton(rec, ply, currentPly, annotation) {
  const meta = annotation ? CLASS_META[annotation.class] : null;
  const classes = ['move-btn'];
  if (ply === currentPly) classes.push('active');
  if (annotation) classes.push(`m-${annotation.class}`);

  let title = rec.san;
  if (annotation) {
    title = `${meta.label}`;
    if (typeof annotation.lossCp === 'number') title += ` · ${formatPawns(annotation.lossCp)} pawns lost`;
    if (annotation.bestSan) title += ` · best was ${annotation.bestSan}`;
  }

  const mark = meta && meta.mark ? `<span class="move-tag">${meta.mark}</span>` : '';
  return `<button type="button" class="${classes.join(' ')}" data-ply="${ply}" title="${title}">${rec.san}${mark}</button>`;
}

function renderControls() {
  if (!els.undo) return;
  els.undo.disabled = !state.history.length || state.thinking;
  els.resign.disabled = state.over;
  els.pause.hidden = !bothBots();
  els.pause.disabled = state.over;
  els.pause.textContent = state.paused ? 'Resume bots' : 'Pause bots';
}

function renderReviewBar() {
  if (!els.reviewBar) return;
  if (state.reviewPly === null) {
    els.reviewBar.hidden = true;
    return;
  }
  els.reviewBar.hidden = false;
  els.reviewText.textContent = state.reviewPly === 0
    ? 'Starting position'
    : `After ${state.history[state.reviewPly - 1].san} · move ${state.reviewPly}`;
  els.reviewPrev.disabled = state.reviewPly === 0;
  els.reviewNext.disabled = state.reviewPly === state.history.length;
}

/* ------------------------------------------------------------------ */
/* Game flow                                                           */
/* ------------------------------------------------------------------ */

function fillSelects() {
  const options = [
    '<option value="human">You (local)</option>',
    ...BOTS.map((bot) => `<option value="${bot.id}">${bot.name} · ${bot.elo}</option>`),
  ].join('');
  els.whiteSelect.innerHTML = options;
  els.blackSelect.innerHTML = options;
  els.whiteSelect.value = 'human';
  els.blackSelect.value = 'casey';
}

function newMatch() {
  stopAnalysisWorker();
  state.gameId += 1;
  state.pos = new Position();
  state.players = {
    white: resolvePlayer(els.whiteSelect.value),
    black: resolvePlayer(els.blackSelect.value),
  };
  state.history = [];
  state.repetition = [state.pos.positionKey()];
  state.over = false;
  state.result = '*';
  state.reason = '';
  state.thinking = false;
  state.paused = false;
  state.selected = -1;
  state.legal = [];
  state.lastMove = null;
  state.reviewPly = null;
  state.flipped = state.players.white.kind === 'bot' && state.players.black.kind === 'human';
  state.analysis = null;
  state.analysisRunning = false;
  state.analysisProgress = { done: 0, total: 0 };
  state.analysisError = null;
  renderAll();
  maybeBot();
}

function handleSquareClick(sq) {
  if (state.reviewPly !== null || state.over || state.thinking || state.paused) return;
  if (!isHuman(state.pos.turn)) return;

  const piece = state.pos.board[sq];

  if (state.selected >= 0) {
    const candidates = state.legal.filter(
      (move) => moveFrom(move) === state.selected && moveTo(move) === sq,
    );
    if (candidates.length) {
      if (candidates.length > 1 && movePromo(candidates[0])) {
        showPromotion(state.selected, sq);
      } else {
        applyMove(candidates[0]);
      }
      return;
    }
  }

  if (piece && (piece >> 3) === state.pos.turn) {
    state.selected = sq;
    state.legal = state.pos.legalMoves();
  } else {
    state.selected = -1;
    state.legal = [];
  }
  renderBoard();
}

function showPromotion(from, to) {
  const color = state.pos.turn;
  const options = [
    [QUEEN, 'Queen'],
    [ROOK, 'Rook'],
    [BISHOP, 'Bishop'],
    [KNIGHT, 'Knight'],
  ];
  els.promo.innerHTML = `
    <div class="promo-card">
      <p>Promote to</p>
      <div class="promo-options">
        ${options.map(([type, name]) => `
          <button type="button" class="promo-option ${color === WHITE ? 'white' : 'black'}"
            data-promo="${type}" aria-label="${name}">${GLYPHS[type]}</button>`).join('')}
      </div>
      <button type="button" class="promo-cancel">Cancel</button>
    </div>`;
  els.promo.hidden = false;

  els.promo.querySelectorAll('[data-promo]').forEach((button) => {
    button.addEventListener('click', () => {
      const promo = Number(button.dataset.promo);
      const move = state.pos.findMove(from, to, promo);
      els.promo.hidden = true;
      if (move) applyMove(move);
    });
  });
  els.promo.querySelector('.promo-cancel').addEventListener('click', closePromotion);
}

function closePromotion() {
  els.promo.hidden = true;
  els.promo.innerHTML = '';
}

function applyMove(move) {
  const pos = state.pos;
  const san = pos.san(move);
  const from = moveFrom(move);
  const to = moveTo(move);
  const record = {
    san,
    uci: moveToUci(move),
    color: colorLetter(pos.turn),
    from,
    to,
    promo: movePromo(move),
    fenBefore: pos.fen(),
  };
  pos.makeMove(move);
  record.fenAfter = pos.fen();
  state.history.push(record);
  state.repetition.push(pos.positionKey());
  state.lastMove = { from, to };
  state.selected = -1;
  state.legal = [];
  state.reviewPly = null;
  resetAnalysis();
  renderAll();
  if (!checkGameEnd()) maybeBot();
}

function checkGameEnd() {
  const pos = state.pos;
  const legal = pos.legalMoves();

  if (!legal.length) {
    if (pos.inCheck()) {
      setOver(pos.turn === WHITE ? '0-1' : '1-0', 'Checkmate');
    } else {
      setOver('1/2-1/2', 'Stalemate');
    }
    return true;
  }
  if (pos.halfmove >= 100) {
    setOver('1/2-1/2', 'Fifty-move rule');
    return true;
  }
  const key = state.repetition[state.repetition.length - 1];
  if (state.repetition.filter((other) => other === key).length >= 3) {
    setOver('1/2-1/2', 'Threefold repetition');
    return true;
  }
  if (isInsufficientMaterial(pos)) {
    setOver('1/2-1/2', 'Insufficient material');
    return true;
  }
  return false;
}

function setOver(result, reason) {
  state.over = true;
  state.thinking = false;
  state.result = result;
  state.reason = reason;
  state.paused = true;
  renderAll();
}

async function maybeBot() {
  if (state.over || state.thinking || state.paused || state.reviewPly !== null) return;
  const color = state.pos.turn;
  if (isHuman(color)) return;

  const player = playerFor(color);
  const bot = player.bot;
  const fen = state.pos.fen();
  const gameId = state.gameId;
  const started = Date.now();

  state.thinking = true;
  state.selected = -1;
  state.legal = [];
  renderSeats();
  renderStatus();
  renderControls();
  renderAnalysis();

  let result = await requestBotMove(fen, bot);
  if (gameId !== state.gameId) return;

  if (!result) {
    // Worker unavailable (e.g. opened from file://): compute in a blocking fallback.
    try {
      const localPos = new Position(fen);
      const local = chooseBotMove(localPos, bot);
      if (local?.move) result = { uci: moveToUci(local.move) };
    } catch (error) {
      console.error('Fallback bot failed', error);
    }
  }

  const wait = Math.max(0, 420 - (Date.now() - started));
  window.setTimeout(() => {
    if (gameId !== state.gameId) return;
    state.thinking = false;
    if (state.over || state.paused) {
      renderAll();
      return;
    }
    const move = result?.uci ? findMoveByUci(state.pos, result.uci) : null;
    if (!move) {
      renderAll();
      return;
    }
    applyMove(move);
  }, wait);
}

function initBotWorker() {
  try {
    botWorker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    botWorker.onmessage = (event) => {
      const message = event.data;
      if (message.type !== 'bot') return;
      const pending = botPending.get(message.id);
      if (!pending) return;
      botPending.delete(message.id);
      window.clearTimeout(pending.timer);
      pending.resolve(message);
    };
    botWorker.onerror = (event) => {
      console.error('Bot worker failed', event.message || event);
      botWorker = null;
      for (const pending of botPending.values()) {
        window.clearTimeout(pending.timer);
        pending.resolve(null);
      }
      botPending.clear();
    };
  } catch (error) {
    console.error('Could not start bot worker', error);
    botWorker = null;
  }
}

function requestBotMove(fen, bot) {
  if (!botWorker) return Promise.resolve(null);
  return new Promise((resolve) => {
    const id = ++botSequence;
    const timer = window.setTimeout(() => {
      botPending.delete(id);
      resolve(null);
    }, 12000);
    botPending.set(id, { resolve, timer });
    botWorker.postMessage({ type: 'bot', id, fen, bot });
  });
}

function undo() {
  if (!state.history.length || state.thinking) return;
  state.history.pop();

  if (!bothBots()) {
    while (state.history.length) {
      const turn = turnFromHistory();
      if (isHuman(turn)) break;
      state.history.pop();
    }
  }

  restoreFromHistory();
  state.over = false;
  state.result = '*';
  state.reason = '';
  state.thinking = false;
  state.paused = false;
  state.reviewPly = null;
  state.selected = -1;
  state.legal = [];
  resetAnalysis();
  renderAll();
  maybeBot();
}

function restoreFromHistory() {
  const startFen = state.history[0]?.fenBefore || START_FEN;
  state.repetition = [new Position(startFen).positionKey()];
  for (const rec of state.history) {
    state.repetition.push(new Position(rec.fenAfter).positionKey());
  }
  state.pos = state.history.length
    ? new Position(state.history[state.history.length - 1].fenAfter)
    : new Position(startFen);
  const last = state.history[state.history.length - 1];
  state.lastMove = last ? { from: last.from, to: last.to } : null;
}

function resign() {
  if (state.over) return;
  const humans = [WHITE, BLACK].filter((color) => isHuman(color));
  const loser = humans.length === 1 ? humans[0] : state.pos.turn;
  setOver(loser === WHITE ? '0-1' : '1-0', `${playerName(loser)} resigned`);
}

function flipBoard() {
  state.flipped = !state.flipped;
  renderSeats();
  renderBoard();
}

function togglePause() {
  state.paused = !state.paused;
  renderControls();
  renderStatus();
  renderSeats();
  if (!state.paused) maybeBot();
}

function reviewAt(ply) {
  if (state.thinking) return;
  state.reviewPly = Math.max(0, Math.min(state.history.length, ply));
  state.selected = -1;
  state.legal = [];
  if (bothBots() && !state.over) state.paused = true;
  renderAll();
}

function backToLive() {
  if (state.reviewPly === null) return;
  state.reviewPly = null;
  renderAll();
  maybeBot();
}

/* ------------------------------------------------------------------ */
/* Analyser                                                            */
/* ------------------------------------------------------------------ */

function resetAnalysis() {
  state.analysisToken += 1;
  if (state.analysisWorker) {
    state.analysisWorker.terminate();
    state.analysisWorker = null;
  }
  state.analysis = null;
  state.analysisRunning = false;
  state.analysisError = null;
}

function stopAnalysisWorker() {
  resetAnalysis();
}

function startAnalysis() {
  if (!state.history.length || state.analysisRunning || state.thinking) return;
  resetAnalysis();

  const fens = [state.history[0].fenBefore, ...state.history.map((rec) => rec.fenAfter)];
  const depth = state.analysisDepth;
  const token = state.analysisToken + 1;
  state.analysisToken = token;
  state.analysisRunning = true;
  state.analysisError = null;
  state.analysisProgress = { done: 0, total: fens.length };
  if (bothBots() && !state.over) state.paused = true;
  renderAnalysis();
  renderControls();
  renderStatus();
  renderSeats();

  let worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  } catch (error) {
    state.analysisRunning = false;
    state.analysisError = 'The analyser worker could not start. Serve the site over http:// rather than opening the file directly.';
    renderAnalysis();
    return;
  }

  state.analysisWorker = worker;

  worker.onmessage = (event) => {
    if (token !== state.analysisToken) return;
    const message = event.data;

    if (message.type === 'progress') {
      state.analysisProgress = { done: message.done, total: message.total };
      renderAnalysis();
      return;
    }

    if (message.type === 'done') {
      try {
        state.analysis = buildMatchReport(fens, state.history, message.results, depth);
      } catch (error) {
        console.error('Could not build report', error);
        state.analysisError = 'The analyser returned data it could not read. Try re-running the analysis.';
      }
      state.analysisRunning = false;
      worker.terminate();
      state.analysisWorker = null;
      renderAll();
    }
  };

  worker.onerror = (event) => {
    console.error('Analysis worker failed', event.message || event);
    if (token !== state.analysisToken) return;
    state.analysisRunning = false;
    state.analysisWorker = null;
    state.analysisError = 'The analyser stopped unexpectedly. Re-run the analysis to try again.';
    renderAnalysis();
  };

  worker.postMessage({
    type: 'analyse',
    id: token,
    fens,
    depth,
    timeLimit: depth >= 4 ? 2600 : 1400,
  });
}

function stopAnalysis() {
  resetAnalysis();
  renderAnalysis();
}

function renderAnalysis() {
  if (!els.analysis) return;

  if (state.analysisError) {
    els.analysis.innerHTML = `
      <div class="analysis-state">
        <p class="analysis-error">${state.analysisError}</p>
        <button type="button" class="btn ghost" data-action="analyse">Try again</button>
      </div>`;
    return;
  }

  if (state.analysisRunning) {
    const { done, total } = state.analysisProgress;
    const percent = total ? Math.round((done / total) * 100) : 0;
    els.analysis.innerHTML = `
      <div class="analysis-state">
        <div class="progress-head">
          <span>Crunching positions</span>
          <strong>${done} / ${total}</strong>
        </div>
        <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
          <span style="width:${percent}%"></span>
        </div>
        <p class="hint">${percent < 100 ? 'Each move gets a full search. This is where the blunders surface.' : 'Finishing the report…'}</p>
        <button type="button" class="btn ghost" data-action="cancel">Cancel</button>
      </div>`;
    return;
  }

  if (state.analysis) {
    els.analysis.innerHTML = reportHTML(state.analysis);
    return;
  }

  if (!state.history.length) {
    els.analysis.innerHTML = `
      <div class="analysis-state">
        <div class="analyser-art" aria-hidden="true">⌕</div>
        <p><strong>Every move, judged.</strong></p>
        <p class="hint">Play a match, then run the analyser for accuracy scores, centipawn loss, an evaluation graph and the exact moments the game slipped.</p>
      </div>`;
    return;
  }

  els.analysis.innerHTML = `
    <div class="analysis-state">
      <p><strong>Ready to review ${state.history.length} move${state.history.length === 1 ? '' : 's'}.</strong></p>
      <p class="hint">The engine re-searches every position and grades each move: best, inaccuracy, mistake or blunder.</p>
      <div class="depth-toggle" role="radiogroup" aria-label="Analysis depth">
        <label>
          <input type="radio" name="analysisDepth" value="3" ${state.analysisDepth === 3 ? 'checked' : ''}>
          <span>Quick · depth 3</span>
        </label>
        <label>
          <input type="radio" name="analysisDepth" value="4" ${state.analysisDepth === 4 ? 'checked' : ''}>
          <span>Deep · depth 4</span>
        </label>
      </div>
      <button type="button" class="btn primary wide" data-action="analyse">Analyse match</button>
    </div>`;
}

function reportHTML(report) {
  const accuracyW = report.accuracy.w;
  const accuracyB = report.accuracy.b;
  const countsW = report.counts.w;
  const countsB = report.counts.b;

  const statRows = [
    ['Accuracy', accuracyW === null ? '—' : `${accuracyW.toFixed(1)}%`, accuracyB === null ? '—' : `${accuracyB.toFixed(1)}%`],
    ['Avg. loss', report.acpl.w === null ? '—' : `${Math.round(report.acpl.w)} cp`, report.acpl.b === null ? '—' : `${Math.round(report.acpl.b)} cp`],
    ['Best moves', countsW.best, countsB.best],
    ['Inaccuracies', countsW.inaccuracy, countsB.inaccuracy],
    ['Mistakes', countsW.mistake, countsB.mistake],
    ['Blunders', countsW.blunder, countsB.blunder],
  ];

  const moments = report.keyMoments.length
    ? report.keyMoments.map((moment) => {
      const meta = CLASS_META[moment.class];
      return `
        <button type="button" class="moment" data-ply="${moment.ply}">
          <span class="moment-badge" style="--badge:${meta.color}">${meta.mark || '?'}</span>
          <span class="moment-copy">
            <strong>${moveNumber(moment.ply)}${moment.color === 'b' ? '…' : '.'} ${moment.san}</strong>
            <small>Best was ${moment.bestSan || '—'} · ${formatPawns(moment.lossCp)} pawns lost</small>
          </span>
        </button>`;
    }).join('')
    : `<p class="hint">No mistakes or blunders detected. A clean sheet.</p>`;

  return `
    <div class="report">
      <div class="report-result">${state.over ? `${state.reason} · ${resultLabel(state.result)}` : 'Game so far'}</div>
      <div class="acc-grid">
        <div class="acc-card">
          <span class="who">${reportName(WHITE)}</span>
          <strong class="acc-value">${accuracyW === null ? '—' : accuracyW.toFixed(1)}</strong>
          <span class="acc-caption">accuracy</span>
          <div class="acc-bar"><i style="width:${accuracyW || 0}%"></i></div>
        </div>
        <div class="acc-card">
          <span class="who">${reportName(BLACK)}</span>
          <strong class="acc-value">${accuracyB === null ? '—' : accuracyB.toFixed(1)}</strong>
          <span class="acc-caption">accuracy</span>
          <div class="acc-bar"><i style="width:${accuracyB || 0}%"></i></div>
        </div>
      </div>

      <table class="stats">
        <thead><tr><th></th><th>White</th><th>Black</th></tr></thead>
        <tbody>
          ${statRows.map(([label, white, black]) => `<tr><td>${label}</td><td>${white}</td><td>${black}</td></tr>`).join('')}
        </tbody>
      </table>

      <div class="chart-block">
        <div class="chart-head"><span>Evaluation</span><span class="chart-legend">white + / black +</span></div>
        ${chartSVG(report)}
      </div>

      <h3 class="report-subhead">Turning points</h3>
      <div class="moments">${moments}</div>

      <div class="report-footer">
        <span>${report.analysedPositions} positions · depth ${report.depth}</span>
        <button type="button" class="btn ghost" data-action="analyse">Re-analyse</button>
      </div>
    </div>`;
}

function chartSVG(report) {
  const W = 420;
  const H = 150;
  const padX = 8;
  const top = 10;
  const bottom = 10;
  const mid = top + (H - top - bottom) / 2;
  const amp = (H - top - bottom) / 2;
  const maxPly = Math.max(1, report.evals.length - 1);
  const x = (index) => padX + (index / maxPly) * (W - padX * 2);
  const y = (cp) => mid - (Math.max(-800, Math.min(800, cp)) / 800) * amp;

  const points = report.evals.map((point, index) => `${x(index).toFixed(1)},${y(point.cp).toFixed(1)}`);
  const line = `M${points.join(' L')}`;
  const area = `${line} L${x(report.evals.length - 1).toFixed(1)},${mid} L${x(0).toFixed(1)},${mid} Z`;

  const markers = report.moves
    .filter((move) => move.class === 'blunder' || move.class === 'mistake')
    .map((move) => {
      const point = report.evals[move.ply];
      const color = CLASS_META[move.class].color;
      return `<line x1="${x(move.ply).toFixed(1)}" y1="${(y(point.cp) - 5).toFixed(1)}" x2="${x(move.ply).toFixed(1)}" y2="${(y(point.cp) + 5).toFixed(1)}" stroke="${color}" stroke-width="2.5" vector-effect="non-scaling-stroke" />`;
    })
    .join('');

  return `
    <svg class="eval-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Evaluation over the game">
      <defs>
        <linearGradient id="evalFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#8a9bff" stop-opacity="0.36" />
          <stop offset="50%" stop-color="#8a9bff" stop-opacity="0.05" />
          <stop offset="100%" stop-color="#5eead4" stop-opacity="0.22" />
        </linearGradient>
      </defs>
      <line x1="${padX}" y1="${mid}" x2="${W - padX}" y2="${mid}" class="midline" vector-effect="non-scaling-stroke" />
      <path d="${area}" fill="url(#evalFill)" />
      <path d="${line}" class="eval-line" vector-effect="non-scaling-stroke" />
      ${markers}
    </svg>`;
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

function wireEvents() {
  els.newMatch.addEventListener('click', newMatch);
  els.flip.addEventListener('click', flipBoard);
  els.undo.addEventListener('click', undo);
  els.resign.addEventListener('click', resign);
  els.pause.addEventListener('click', togglePause);

  els.board.addEventListener('click', (event) => {
    const cell = event.target.closest('.sq');
    if (!cell) return;
    handleSquareClick(Number(cell.dataset.sq));
  });

  els.promo.addEventListener('click', (event) => {
    if (event.target === els.promo) closePromotion();
  });

  els.moves.addEventListener('click', (event) => {
    const button = event.target.closest('[data-ply]');
    if (button) reviewAt(Number(button.dataset.ply));
  });

  els.reviewPrev.addEventListener('click', () => reviewAt((state.reviewPly ?? state.history.length) - 1));
  els.reviewNext.addEventListener('click', () => reviewAt((state.reviewPly ?? state.history.length) + 1));
  els.reviewLive.addEventListener('click', backToLive);

  els.analysis.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="analyse"]')) {
      startAnalysis();
      return;
    }
    if (event.target.closest('[data-action="cancel"]')) {
      stopAnalysis();
      return;
    }
    const moment = event.target.closest('.moment[data-ply]');
    if (moment) reviewAt(Number(moment.dataset.ply));
  });

  els.analysis.addEventListener('change', (event) => {
    if (event.target.name === 'analysisDepth') {
      state.analysisDepth = Number(event.target.value) === 4 ? 4 : 3;
    }
  });

  document.addEventListener('keydown', (event) => {
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      reviewAt((state.reviewPly ?? state.history.length) - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      reviewAt((state.reviewPly ?? state.history.length) + 1);
    } else if (event.key === 'Escape') {
      backToLive();
    }
  });
}

function init() {
  els.whiteSelect = $('#whiteSelect');
  els.blackSelect = $('#blackSelect');
  els.newMatch = $('#newMatch');
  els.seatTop = $('#seatTop');
  els.seatBottom = $('#seatBottom');
  els.board = $('#board');
  els.promo = $('#promo');
  els.statusText = $('#statusText');
  els.statusDot = $('#statusDot');
  els.moves = $('#moves');
  els.undo = $('#undo');
  els.resign = $('#resign');
  els.flip = $('#flip');
  els.pause = $('#pause');
  els.analysis = $('#analysis');
  els.analysisCard = $('#analysisCard');
  els.reviewBar = $('#reviewBar');
  els.reviewText = $('#reviewText');
  els.reviewPrev = $('#reviewPrev');
  els.reviewNext = $('#reviewNext');
  els.reviewLive = $('#reviewLive');

  fillSelects();
  initBotWorker();
  wireEvents();
  newMatch();
}

init();
