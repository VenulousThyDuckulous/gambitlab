import { Position, findBestMove, moveToUci, MATE } from './engine.js';
import { chooseBotMove } from './bots.js';

self.onmessage = (event) => {
  const message = event.data;

  if (message.type === 'bot') {
    const pos = new Position(message.fen);
    const result = chooseBotMove(pos, message.bot);
    self.postMessage({
      type: 'bot',
      id: message.id,
      uci: result?.move ? moveToUci(result.move) : null,
      score: result?.score ?? 0,
      depth: result?.depth ?? 0,
      slipped: Boolean(result?.slipped),
    });
    return;
  }

  if (message.type === 'analyse') {
    const { id, fens, depth, timeLimit } = message;
    const results = [];

    for (let i = 0; i < fens.length; i++) {
      const pos = new Position(fens[i]);
      const legal = pos.legalMoves();
      let entry;

      if (!legal.length) {
        entry = {
          score: pos.inCheck() ? -MATE : 0,
          best: null,
          terminal: pos.inCheck() ? 'checkmate' : 'stalemate',
          depth: 0,
        };
      } else {
        const search = findBestMove(pos, depth, { timeLimit: timeLimit || 1500 });
        entry = {
          score: search.score,
          best: search.move ? moveToUci(search.move) : null,
          depth: search.depth,
        };
      }

      results.push(entry);
      self.postMessage({
        type: 'progress',
        id,
        done: i + 1,
        total: fens.length,
        entry,
      });
    }

    self.postMessage({ type: 'done', id, results });
  }
};
