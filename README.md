# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/agungsjtnk/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/agungsjtnk/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Every pre-token protocol in the snapshot, ranked by what its token would be worth.

Token Radar reads the sealed snapshot of 758 protocols and ranks the 198 that record no token yet — the snapshot's full 40-protocol watchlist included — by an implied value computed from each protocol's own figures:

```
implied = TVL × base × growth multiplier × maturity multiplier
```

- **base = 0.179099** — the median market-cap/TVL ratio of the snapshot's own 132 live protocols (exchanges and chains excluded): the market's own yardstick, measured from the data, not chosen.
- **growth multiplier** — `1 + 0.9 · tanh(clamp(change_7d, −50, 150) / 45)`: a hot week lifts a protocol, a cold week cuts it, and no single wild week swamps the board.
- **maturity multiplier** — `0.55 + 0.65 · (1 − exp(−age / 620))`: the longer a protocol has operated without a token, the more of its value the model credits, saturating near three years.

Each ranked row also carries a 7-step farm plan (named action, dollar cost, time) generated from the protocol's own category and chains. The 416 protocols that already trade are shown separately at their real market caps, never ranked.

The dashboard is a static, fully offline page (dark night-scope theme): search, chain/category filters, a watchlist-only toggle, sortable columns, and a per-protocol detail drawer that recomputes the row's value breakdown from the same figures and shows the farm plan. Live preview: https://agungsjtnk.github.io/token-radar-live/dashboard/

## Run it

Node 22, standard library only, no network. The program runs twice in the grader's sandbox and writes byte-identical output.

```
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Outputs: `board.json` (the ranked board), `data.js` (the dashboard's data), `dashboard/`, `screenshots/`, and `dossier.json` built by the vendored make.fun library so the scorer can rebuild it byte for byte.

## Entry

Built by an AI agent for make.fun's ["Build the best token launch radar"](https://make.fun/bounty/token-radar-01) bounty (token-radar-01). MIT licensed.
