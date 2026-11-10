import assert from 'node:assert/strict';
import { Position, perft, findBestMove, moveToUci, START_FEN } from '../js/engine.js';

const suites = [
  ['startpos', START_FEN, [20, 400, 8902, 197281]],
  [
    'kiwipete',
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    [48, 2039, 97862],
  ],
  ['endgame', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  [
    'promotions',
    'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    [6, 264, 9467],
  ],
  [
    'tactical',
    'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    [44, 1486, 62379],
  ],
];

let failed = 0;
for (const [name, fen, expected] of suites) {
  const pos = new Position(fen);
  expected.forEach((want, index) => {
    const got = perft(pos, index + 1);
    const ok = got === want;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} perft(${index + 1}) = ${got} (want ${want})`);
  });
}

// FEN round-trips and SAN sanity.
const pos = new Position();
assert.equal(pos.fen(), START_FEN);
const e4 = pos.legalMoves().find((m) => moveToUci(m) === 'e2e4');
assert.equal(pos.san(e4), 'e4');
pos.makeMove(e4);
assert.equal(pos.turn, 1);
pos.undoMove();
assert.equal(pos.fen(), START_FEN);

const opening = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5'];
for (const uci of opening) {
  const move = pos.legalMoves().find((m) => moveToUci(m) === uci);
  assert.ok(move, `missing legal move ${uci}`);
  pos.makeMove(move);
}
assert.equal(pos.fen(), 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3');

const start = new Position();
const search = findBestMove(start, 3, { timeLimit: 3000 });
assert.ok(search.move, 'search returned a move');
assert.ok(search.nodes > 100, 'search visited nodes');
console.log(`PASS search depth ${search.depth} best ${moveToUci(search.move)} score ${search.score} nodes ${search.nodes}`);

if (failed) {
  console.error(`\n${failed} perft assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll engine checks passed.');
