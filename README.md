# Token Launch Radar — model radar-3

A token-radar-01 entry. It reads the sealed DefiLlama snapshot, ranks every
pre-token protocol by what its token would be worth if it launched today, and
hands in a static dashboard: a sortable, filterable board, a detail view for
every protocol, and a seven-step farm plan per row.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Node 22.18 or later (runs as-is; no install, no network). `main.ts` writes
`board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json`
into the output directory. Two runs on the same snapshot write the same bytes.

## Layout

- `main.ts` — entrypoint: read snapshot, score, write outputs, build dossier
- `lib/model.ts` — the model: calibration, ranking, farm plans, backtest
- `dashboard/` — the static page (`index.html`, `app.css`, `app.js`; ~20 KB total, no network)
- `screenshots/` — the board, a protocol detail view, and a filtered view (1440×900)
- `vendor/makefun-board.ts` — the kit's dossier library, byte for byte
- `MODEL_NOTES.md` — the model, its calibration numbers, coverage and backtest

## The model in one line

```
implied = TVL × category multiple × growth × maturity × breadth
```

The category multiple is the median market-cap-to-TVL ratio of the snapshot's
own live-token protocols in the same category (≥ 5 comparables, else the
overall median 0.2460), capped at 1.0. Growth is one week of TVL change,
clamped and half-weighted; maturity rises 0.5 → 1.0 over four years with no
token; breadth adds 5% per extra chain, capped at ten. See MODEL_NOTES.md for
the numbers, the limits, and the honest backtest (median log error ≈ 1.60 —
a ranking prior, not a price forecast).

## Results on the sealed snapshot (2026-11-14)

- 198 rows: the full 40-protocol watchlist, plus 138 rankable protocols below
  the $50M floor and 20 above it that the watchlist leaves out
- Top row: Steakhouse Financial, $689.4M implied
- Dashboard source 20,532 bytes (the judge reads it whole); dossier 45 KB
