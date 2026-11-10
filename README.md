# GambitLab

Chess against Elo-rated bots, then a brutal post-game review.

**Live site:** https://venulousthyduckulous.github.io/gambitlab/

![No dependencies](https://img.shields.io/badge/dependencies-none-5eead4) ![Engine](https://img.shields.io/badge/engine-original%200x88-8a9bff)

## What it does

- **Playable chess** with the full rule set: castling, en passant, promotion (with a picker), checkmate, stalemate, threefold repetition, the fifty-move rule and insufficient material.
- **Eight Elo-rated bots** from 500 to 2250. Their strength comes from search depth plus a deliberate imperfection model: each bot sometimes picks a plausible move from a shallow ranking, with the margin and frequency tied to its rating. You can play either side, or put a bot on both sides and watch.
- **Match analyser** that re-searches every position after the game. It reports accuracy, average centipawn loss, best-move counts, inaccuracies, mistakes, blunders, an evaluation graph and the game's turning points. Click any move or turning point to step back through the board.

Everything runs client-side. There is no backend, no Stockfish and no third-party JavaScript.

## The engine

The engine in `js/engine.js` is written from scratch:

- 0x88 board representation and incremental make/unmake
- Legal move generation with discovered-check filtering
- SAN generation with proper disambiguation
- Material + piece-square-table evaluation with a king endgame table and bishop-pair bonus
- Iterative-deepening negamax with alpha-beta pruning, MVV-LVA ordering and quiescence search
- Time-limited search, so even the top bot always moves promptly

Correctness is checked with [perft](https://www.chessprogramming.org/Perft_Results) on five standard positions:

```bash
npm test
```

Search, analysis and bot move selection run in a Web Worker, so the board never freezes while the engine thinks.

## Analysis method

Each position is searched to a fixed depth (3 for Quick, 4 for Deep). A move is graded by the centipawn loss relative to the engine's best move:

| Grade | Centipawn loss |
| --- | --- |
| Best | engine's top choice |
| Excellent | < 20 |
| Good | < 60 |
| Inaccuracy | < 120 |
| Mistake | < 250 |
| Blunder | ≥ 250 |

Accuracy uses the win-percentage drop caused by the move (the same approach Lichess popularised), averaged per player. Evaluations are clamped to ±12 pawns, with mate scores handled explicitly.

## Bots

| Bot | Elo | Search depth |
| --- | --- | --- |
| Pawnpoke Pip | 500 | 1 |
| Novice Nina | 750 | 1 |
| Casual Carl | 1000 | 2 |
| Club Casey | 1250 | 2 |
| Tactical Tess | 1500 | 3 |
| Expert Emil | 1750 | 3 |
| Master Mira | 2000 | 4 |
| Grandmaster Gale | 2250 | 4 |

The Elo labels are a difficulty guide, not a calibrated rating. The imperfection model is intentionally heuristic.

## Run locally

No build step and no install needed:

```bash
python3 -m http.server 3002
# open http://localhost:3002
```

A local server is required for the module Worker (Web Workers do not run from `file://`; the bot falls back to the main thread, and analysis reports the limitation).

## Structure

```
index.html          markup and layout
css/styles.css      visual design
js/engine.js        rules, move generation, evaluation, search
js/bots.js          Elo bot roster and move selection
js/analysis.js      grading, accuracy and report building
js/worker.js        worker entry point for bots + analysis
js/app.js           UI, game flow, rendering, event wiring
tests/perft.mjs     engine correctness suite
```
