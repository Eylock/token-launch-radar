# MODEL_NOTES.md — token radar, model radar-3

Snapshot: `input/snapshot.json`, as_of 2026-11-14, 758 protocols, floor $50M,
40-protocol watchlist. Everything below is computed from that snapshot at run
time by `lib/model.ts` (`calibrate()`); no number in the model is a hard-coded
guess about any protocol, and no protocol name is ever special-cased.

## Formula

```
implied = TVL x categoryMultiple x growth x maturity x breadth
  (rounded to whole dollars, minimum $1)
```

| Factor | Definition | Range on this board |
|---|---|---|
| `categoryMultiple` | Median mcap/TVL of the snapshot's own live-token protocols, per category when the category has >= 5 live comparables, else the overall median. Capped at 1.0. | 0.1324 – 0.6544 |
| `growth` | `1 + 0.5 x clamp(change_7d, -60, +120) / 100`; `change_7d` null counts as 0% | 0.70 – 1.60 |
| `maturity` | `0.5 + min(age_days, 1460) / 1460 x 0.5`; age = as_of − listed_at; unknown listed_at counts as 365 days | 0.50 – 1.00 |
| `breadth` | `1 + 0.05 x min(max(chains − 1, 0), 10)` | 1.00 – 1.50 |

## Why each factor

- **categoryMultiple (calibration).** A flat multiple for every protocol is
  wrong: the snapshot's own live tokens say lending protocols trade near
  0.13x TVL while bridges trade near 0.56–0.75x. A median is used because
  mcap/TVL ratios are wildly dispersed (one Prediction Market at 400x); a mean
  would be dragged by a single outlier. The >= 5 comparables threshold keeps
  a lone wild ratio (one Token Locker at 9.5x) from becoming a whole
  category's multiple. The 1.0 cap says a token's median multiple may not
  exceed the value it secures. CEX is excluded from comparables: an exchange
  token prices the exchange, not a protocol's TVL. Comparables require mcap
  > 0 and TVL > 0, because a market cap of 0 or −1 is DefiLlama's placeholder
  for "no usable quote", not a price.
- **growth.** One week of TVL flow is noisy, so it is clamped (−60% / +120%;
  the snapshot's raw max is +4448%) and half-weighted: only about half of a
  single week's flow is treated as durable. A protocol growing +120% in a week
  earns +60% implied value; one shrinking −60% loses 30%.
- **maturity.** A protocol that has run for years with no token has survived
  more than one that listed last month, so age earns up to 2x (0.5 → 1.0)
  over four years. Rankable protocols run 2–1845 days old (median 418), so a
  3-year cap would saturate too early. Unknown listing date counts as 365
  days (0.625) — neither newborn nor veteran.
- **breadth.** Each extra chain adds 5%, capped at ten extra chains:
  multichain distribution widens the future holder base, but a 45-chain
  listing is mostly the same deployment copied, not 45x the reach. The median
  rankable protocol is on one chain, so most rows score 1.00 here.

## Calibration numbers (this snapshot, computed at run time)

- Comparables (live-token, mcap > 0, TVL > 0, ex-CEX): **119**
- Overall median mcap/TVL: **0.2460**
- Per-category medians actually applied (>= 5 comparables):

| Category | n | Median mcap/TVL |
|---|---|---|
| Lending | 15 | 0.1324 |
| Yield | 9 | 0.1914 |
| RWA | 9 | 0.2748 |
| Dexs | 11 | 0.3424 |
| Bridge | 6 | 0.5567 |
| Basis Trading | 7 | 0.6544 |

Two more categories are calibrated but never apply to a board row, because the
rankability rule excludes them: Liquid Staking (9, 0.0406) and Canonical
Bridge (8, 0.7464). Every other category has fewer than 5 live comparables
and falls back to the overall median 0.2460. That is the honest limit of this
snapshot: the two biggest rankable groups, Risk Curators (34 rows) and
Onchain Capital Allocator (18 rows), have almost no live comparables, so they
are all priced at the overall median and separated only by TVL, growth,
maturity and breadth.

## Coverage

- Watchlist slugs on the board: **40 / 40**
- Other rankable pre-token protocols below the $50M floor: **138**
- Other rankable pre-token protocols above the floor but not on the watchlist: **20**
- **Total rows: 198** (no TVL top-N cut; ranked by implied value, ties by slug)

Rankable = pre-token (mcap_usd, gecko_id and symbol all null) and not excluded
by the watchlist's own rule: category not in {Bridge, Canonical Bridge,
Liquid Staking, Liquid Restaking, Restaked BTC, CEX}; name not ending in a
version marker; no whole word wrapped/staked/staking in the name; name not
starting with an exchange name (Binance, Coinbase, Bybit, Kraken, Bitget,
OKX, Bitfinex, Gemini). Protocols whose record carries a symbol or gecko_id
but no market cap are NOT pre-token here — all three fields must be null.

Note on the 20 above-floor non-watchlist rows: the house watchlist additionally
leans on DefiLlama's `parentProtocol`, which the snapshot does not carry, so
these 20 pass every snapshot-visible rule yet are not on the watchlist (e.g.
Sentora Curator, Polymarket International, CIAN Yield Layer). The radar ranks
them anyway, by the stated rule, rather than inventing a reason to drop them.
342 protocols record no token; 144 of them are excluded by the rule above
(128 by category, 11 version-marked, 5 by wrapped/staked/staking wording).

## Farm plans

Every row carries **7 steps**, each 20–600 characters (observed 109–257),
each with a cost and a time, all derived from the protocol's own record:

1. Fresh wallet holding only the farm funds; seed phrase offline.
2. The category's main action, with capital by TVL tier (>= $5B: $250;
   >= $1B: $150; >= $100M: $100; else $50), gas priced by the main chain.
3. A second, different qualifying action for the same category, at half the
   main capital (e.g. supply, then borrow against it; provide liquidity,
   then swap through the router).
4. One qualifying action per week (deposit, borrow, swap or vote).
5. Hold the main position for 90 days if under 180 days old, 60 days if
   180–365 days old or age unknown, 45 days if older.
6. Claim-safety: claim only from the link the protocol itself publishes;
   never pay a fee to claim; never connect from a link in a DM.
7. Log the wallet, dates, amounts and every transaction hash.

Gas is a snapshot-date planning estimate per transaction on the main chain
(Ethereum $3.00, Solana $0.02, Base $0.05, Arbitrum $0.10, Optimism $0.05,
Binance $0.15, Polygon $0.05, Avalanche $0.30, other named chains $0.02–$0.50,
unlisted chains $0.50) — a planning figure, not a live quote.

## Backtest (leave-one-out, on the snapshot's own live-token protocols)

For each of the 119 comparables, the market cap is predicted from TVL with
the calibrated multiple fitted WITHOUT that protocol (its category's median
of the other comparables when at least 5 remain, else the overall median of
the others). Error is |log(predicted / actual)|. Computed by
`backtestCalibration()` in `lib/model.ts`; the same function also scores the
flat 0.25 baseline and the full radar-3 formula (LOO multiple × growth ×
maturity × breadth).

| Predictor | Median \|log err\| | Mean \|log err\| |
|---|---|---|
| Calibrated multiple (LOO) | **1.601** | 1.857 |
| Flat 0.25 (baseline) | 1.602 | 1.756 |
| Full radar-3 formula (LOO) | 1.686 | 1.864 |

Read honestly: a median log error of 1.60 means the typical prediction is off
by about a factor of e^1.60 ≈ 5x — live mcap/TVL ratios are that dispersed,
and no TVL-only model will predict a single token's market cap well. The
per-category calibration essentially ties the flat 0.25 on median error
(1.601 vs 1.602) and loses slightly on mean error (1.857 vs 1.756), because a
few bridge comparables are capped at 1.0 in the LOO fit. Its value is not
aggregate accuracy but **differentiation**: it stops pricing a lending
protocol and a bridge as if they were the same business (0.13x vs 0.56x),
which is what changes the ranking. The extra growth/maturity/breadth factors
slightly worsen live-token prediction (1.686) — they are ranking priors for
pre-token protocols (momentum, survival, distribution), not fitted predictors
of live market caps, and the notes say so rather than claiming a fit they do
not have.

## Determinism

Pure function of the snapshot bytes. No `Date.now()`, no `Math.random()`, no
network. Ties break by slug. Two runs into two output directories are
byte-identical (`diff -r` clean, verified 2026-11-24).

## Top 10 rows (this snapshot)

| Rank | Slug | Category | TVL | Implied value |
|---|---|---|---|---|
| 1 | steakhouse-financial | Risk Curators | $2,753,981,495 | $689,404,858 |
| 2 | sentora-curator | Risk Curators | $2,757,585,593 | $504,675,053 |
| 3 | gauntlet | Risk Curators | $1,577,685,462 | $410,592,811 |
| 4 | veda | Onchain Capital Allocator | $1,563,415,482 | $396,162,280 |
| 5 | usdd | CDP | $1,055,793,606 | $199,777,062 |
| 6 | upshift | Onchain Capital Allocator | $499,083,733 | $142,540,614 |
| 7 | bitfi-basis | Basis Trading | $214,934,379 | $124,639,374 |
| 8 | polymarket-international | Prediction Market | $320,193,439 | $78,337,656 |
| 9 | cian-yield-layer | Yield Aggregator | $280,281,384 | $68,666,690 |
| 10 | nonce-capital | Risk Curators | $513,783,671 | $65,066,792 |

Note: ranks 1–4 and 6 are priced at the fallback overall median (0.2460)
because Risk Curators and Onchain Capital Allocator have almost no live
comparables — their order is set by TVL, growth, maturity and breadth, not by
a category multiple. That is the snapshot's limit, stated above, not a hidden
assumption.
