import { findBestMove, searchRootMoves } from './engine.js';

/**
 * Bots are defined by an Elo label plus the levers that actually shape play:
 * search depth, how often they "slip", how wide a margin of moves they consider,
 * and how randomly they choose inside that margin.
 */
export const BOTS = [
  {
    id: 'pip',
    name: 'Pawnpoke Pip',
    elo: 500,
    depth: 1,
    slip: 0.62,
    window: 640,
    temp: 190,
    timeLimit: 700,
    tagline: 'Pushes pawns with confidence.',
  },
  {
    id: 'nina',
    name: 'Novice Nina',
    elo: 750,
    depth: 1,
    slip: 0.5,
    window: 400,
    temp: 120,
    timeLimit: 800,
    tagline: 'Knows the rules. Mostly.',
  },
  {
    id: 'carl',
    name: 'Casual Carl',
    elo: 1000,
    depth: 2,
    slip: 0.38,
    window: 260,
    temp: 95,
    timeLimit: 900,
    tagline: 'Plays fast, regrets faster.',
  },
  {
    id: 'casey',
    name: 'Club Casey',
    elo: 1250,
    depth: 2,
    slip: 0.28,
    window: 165,
    temp: 78,
    timeLimit: 1000,
    tagline: 'Solid until the tactics start.',
  },
  {
    id: 'tess',
    name: 'Tactical Tess',
    elo: 1500,
    depth: 3,
    slip: 0.18,
    window: 105,
    temp: 62,
    timeLimit: 1200,
    tagline: 'Sniffs out forks and pins.',
  },
  {
    id: 'emil',
    name: 'Expert Emil',
    elo: 1750,
    depth: 3,
    slip: 0.11,
    window: 68,
    temp: 48,
    timeLimit: 1400,
    tagline: 'Punishes loose pieces.',
  },
  {
    id: 'mira',
    name: 'Master Mira',
    elo: 2000,
    depth: 4,
    slip: 0.06,
    window: 38,
    temp: 38,
    timeLimit: 1600,
    tagline: 'Calculates before you blink.',
  },
  {
    id: 'gale',
    name: 'Grandmaster Gale',
    elo: 2250,
    depth: 4,
    slip: 0.02,
    window: 18,
    temp: 26,
    timeLimit: 1900,
    tagline: 'The house always wins.',
  },
];

export function botById(id) {
  return BOTS.find((bot) => bot.id === id) || BOTS[3];
}

function weightedPick(pool, top, temp) {
  let total = 0;
  const weights = pool.map((entry) => {
    const weight = Math.exp((entry.score - top) / Math.max(1, temp));
    total += weight;
    return weight;
  });
  let roll = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/**
 * Pick a move for a bot. The deep search supplies its best move; weaker bots
 * sometimes substitute a plausible-but-imperfect move from a shallow ranking,
 * with the frequency and margin controlled by their Elo.
 */
export function chooseBotMove(pos, bot) {
  const legal = pos.legalMoves();
  if (!legal.length) return { move: null, score: 0, depth: 0 };

  const strong = findBestMove(pos, bot.depth, { timeLimit: bot.timeLimit || 1500 });
  if (legal.length === 1 || Math.random() >= bot.slip) return strong;

  const ranked = searchRootMoves(pos, 2, { timeLimit: 900 });
  if (!ranked.length) return strong;

  const top = ranked[0].score;
  const pool = ranked.filter((entry) => entry.score >= top - bot.window).slice(0, 9);
  const picked = weightedPick(pool, top, bot.temp);
  return { move: picked.move, score: picked.score, depth: 2, slipped: true };
}
