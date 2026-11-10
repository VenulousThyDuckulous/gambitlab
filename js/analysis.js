import { Position, MATE, moveToUci } from './engine.js';

export const CLASS_META = {
  best: { label: 'Best', mark: '', color: '#9bd67a' },
  excellent: { label: 'Excellent', mark: '', color: '#7fc48b' },
  good: { label: 'Good', mark: '', color: '#9aa8bb' },
  inaccuracy: { label: 'Inaccuracy', mark: '?!', color: '#e9c94b' },
  mistake: { label: 'Mistake', mark: '?', color: '#f0943f' },
  blunder: { label: 'Blunder', mark: '??', color: '#ef5b5b' },
  forced: { label: 'Forced', mark: '→', color: '#8a9bff' },
};

export function sideToMove(fen) {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}

function emptyCounts() {
  return { best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, forced: 0 };
}

/** Convert engine scores (which may be mates) into a bounded centipawn value. */
function boundedCp(score) {
  if (score >= MATE - 1000) return 1200;
  if (score <= -MATE + 1000) return -1200;
  return Math.max(-1200, Math.min(1200, score));
}

function winPercent(cp) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

/**
 * Turn fixed-depth engine scores into a human-readable match report.
 * Accuracy uses the win-percentage drop, the same idea Lichess popularised.
 */
export function buildMatchReport(fens, moves, analyses, depth = 3) {
  const counts = { w: emptyCounts(), b: emptyCounts() };
  const sumAccuracy = { w: 0, b: 0 };
  const sumLoss = { w: 0, b: 0 };
  const moveCount = { w: 0, b: 0 };
  const annotatedMoves = [];
  const keyMoments = [];

  const startTurn = sideToMove(fens[0]);
  const startScore = analyses[0]?.score ?? 0;
  const startWhite = startTurn === 'w' ? startScore : -startScore;
  const evals = [{ ply: 0, cp: Math.max(-800, Math.min(800, startWhite)), raw: startWhite }];

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    const beforeInfo = analyses[i];
    const afterInfo = analyses[i + 1];
    const color = move.color;

    const pos = new Position(fens[i]);
    const legal = pos.legalMoves();
    const forced = legal.length === 1;

    let bestSan = '';
    if (beforeInfo?.best) {
      const bestMove = legal.find((candidate) => moveToUci(candidate) === beforeInfo.best);
      if (bestMove) bestSan = pos.san(bestMove);
    }

    const before = boundedCp(beforeInfo?.score ?? 0);
    const after = boundedCp(-(afterInfo?.score ?? 0));
    const loss = Math.max(0, before - after);
    const playedBest = beforeInfo?.best === move.uci;

    let cls;
    if (forced) cls = 'forced';
    else if (playedBest || loss <= 2) cls = 'best';
    else if (loss < 20) cls = 'excellent';
    else if (loss < 60) cls = 'good';
    else if (loss < 120) cls = 'inaccuracy';
    else if (loss < 250) cls = 'mistake';
    else cls = 'blunder';

    let accuracy = 100;
    if (!forced && !playedBest) {
      const drop = Math.max(0, winPercent(before) - winPercent(after));
      accuracy = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669;
      accuracy = Math.max(0, Math.min(100, accuracy));
    }

    counts[color][cls] += 1;
    sumAccuracy[color] += accuracy;
    sumLoss[color] += loss;
    moveCount[color] += 1;

    const afterTurn = sideToMove(fens[i + 1]);
    const whiteCp = afterTurn === 'w' ? (afterInfo?.score ?? 0) : -(afterInfo?.score ?? 0);
    evals.push({
      ply: i + 1,
      cp: Math.max(-800, Math.min(800, whiteCp)),
      raw: whiteCp,
    });

    const annotated = {
      ...move,
      ply: i + 1,
      class: cls,
      lossCp: Math.round(loss),
      accuracy: round1(accuracy),
      bestUci: beforeInfo?.best || null,
      bestSan,
      evalWhite: Math.round(whiteCp),
    };
    annotatedMoves.push(annotated);

    if (cls === 'mistake' || cls === 'blunder') {
      keyMoments.push(annotated);
    }
  }

  keyMoments.sort((a, b) => b.lossCp - a.lossCp);

  return {
    depth,
    moves: annotatedMoves,
    counts,
    evals,
    keyMoments: keyMoments.slice(0, 4),
    accuracy: {
      w: moveCount.w ? round1(sumAccuracy.w / moveCount.w) : null,
      b: moveCount.b ? round1(sumAccuracy.b / moveCount.b) : null,
    },
    acpl: {
      w: moveCount.w ? round1(sumLoss.w / moveCount.w) : null,
      b: moveCount.b ? round1(sumLoss.b / moveCount.b) : null,
    },
    analysedPositions: fens.length,
  };
}
