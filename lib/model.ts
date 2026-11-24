// Token Launch Radar — value model, board builder and farm plans.
//
// The model is a pure function of the sealed snapshot's bytes. It calibrates
// itself from the snapshot's own live-token protocols, scores every rankable
// pre-token protocol, and writes a seven-step farm plan per row. No network,
// no clock, no randomness: the same snapshot bytes always build the same board.
//
// Model (derived from the snapshot, see MODEL_NOTES.md):
//   implied = TVL x categoryMultiple x growth x maturity x breadth
//   categoryMultiple — median mcap/TVL of the snapshot's live-token protocols
//     in the same category (at least 5 comparables, else the overall median),
//     capped at 1.0, so a token is never priced above the value it secures.
//   growth    — 1 + 0.5 x clamp(change_7d, -60, +120) / 100; a week of TVL
//     flow is noisy, so it is clamped and half-weighted.
//   maturity  — 0.5 + min(age_days, 1460) / 1460 x 0.5; older protocols that
//     have run with no token earn up to twice a newborn's multiple.
//   breadth   — 1 + 0.05 x min(max(chains - 1, 0), 10); each extra chain adds
//     5%, capped at ten, because a 45-chain listing is mostly one deployment
//     copied, not 45x the reach.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface Factors {
  category_multiple: number;
  growth: number;
  maturity: number;
  breadth: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  chain_count: number;
  main_chain: string;
  watchlist: boolean;
  factors: Factors;
}

export interface Calibration {
  /** Median mcap/TVL over all live-token comparables (CEX excluded). */
  overall_median: number;
  /** Per-category medians, only where the category has >= 5 comparables. */
  category_medians: Record<string, number>;
  /** How many comparables each calibrated category had. */
  category_counts: Record<string, number>;
  comparables: number;
}

export interface Radar {
  rows: BoardRow[];
  watchlist_size: number;
  early_size: number;
  live_size: number;
  calibration: Calibration;
  as_of: string;
}

/** The median of a non-empty list of numbers. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Clamp x into [lo, hi]. */
function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Parse and lightly validate the snapshot JSON text. */
export function parseSnapshot(text: string): Snapshot {
  const data = JSON.parse(text) as Snapshot;
  if (!Array.isArray(data.protocols) || !Array.isArray(data.watchlist)) {
    throw new Error('snapshot: expected protocols[] and watchlist[]');
  }
  if (typeof data.as_of !== 'string' || typeof data.floor_usd !== 'number') {
    throw new Error('snapshot: expected as_of and floor_usd');
  }
  return data;
}

/** A protocol records no token when all three token fields are null. */
function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_PREFIXES = [
  'Binance',
  'Coinbase',
  'Bybit',
  'Kraken',
  'Bitget',
  'OKX',
  'Bitfinex',
  'Gemini',
];

const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * Rankable = records no token and is not a wrapped, staked or bridged product
 * of a token that already trades. This is the watchlist's own rule, applied
 * to every protocol in the snapshot — the watchlist is the floor, not the
 * ceiling, so rankable protocols below the floor rank too.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) return false;
  return true;
}

/**
 * Calibrate the base multiples from the snapshot's own live-token protocols:
 * market cap over TVL, for protocols with a usable quote (mcap > 0, TVL > 0),
 * excluding CEX — an exchange token prices the exchange, not a protocol's TVL.
 * A median is used because the ratios are wildly dispersed (one at 400x);
 * a mean would be dragged by a single outlier.
 */
export function calibrate(snapshot: Snapshot): Calibration {
  const comparables = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX',
  );
  const overall = median(comparables.map((p) => p.mcap_usd! / p.tvl_usd));
  const byCategory = new Map<string, number[]>();
  for (const p of comparables) {
    const key = p.category ?? '(none)';
    const list = byCategory.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    byCategory.set(key, list);
  }
  const category_medians: Record<string, number> = {};
  const category_counts: Record<string, number> = {};
  for (const [category, ratios] of byCategory) {
    // Fewer than 5 comparables and a lone wild ratio would become the whole
    // category's multiple; those categories fall back to the overall median.
    if (ratios.length >= 5) {
      category_medians[category] = median(ratios);
      category_counts[category] = ratios.length;
    }
  }
  return { overall_median: overall, category_medians, category_counts, comparables: comparables.length };
}

/** The multiple a category is priced at: its calibrated median, else overall. */
function categoryMultiple(calibration: Calibration, category: string | null): number {
  const own = category === null ? undefined : calibration.category_medians[category];
  const raw = own === undefined ? calibration.overall_median : own;
  return Math.min(raw, 1.0);
}

/** Whole days between the snapshot date and the protocol's listing date. */
export function ageDays(snapshot: Snapshot, p: SnapshotProtocol): number | null {
  if (p.listed_at === null) return null;
  const age = (Date.parse(snapshot.as_of) - Date.parse(p.listed_at)) / 86_400_000;
  return age < 0 ? 0 : Math.floor(age);
}

/** The four factors for one protocol, each derived from its own record. */
export function factors(snapshot: Snapshot, calibration: Calibration, p: SnapshotProtocol): Factors {
  const growth =
    1 + (0.5 * clamp(p.change_7d === null ? 0 : p.change_7d, -60, 120)) / 100;
  const age = ageDays(snapshot, p);
  const days = age === null ? 365 : age;
  const maturity = 0.5 + (Math.min(days, 1460) / 1460) * 0.5;
  const breadth = 1 + 0.05 * Math.min(Math.max(p.chains.length - 1, 0), 10);
  return {
    category_multiple: categoryMultiple(calibration, p.category),
    growth,
    maturity,
    breadth,
  };
}

/** The implied value of a token launch, in whole dollars, at least $1. */
export function impliedValue(p: SnapshotProtocol, f: Factors): number {
  const value = p.tvl_usd * f.category_multiple * f.growth * f.maturity * f.breadth;
  return Math.max(1, Math.round(value));
}

// ---------------------------------------------------------------------------
// Farm plans
// ---------------------------------------------------------------------------

/** Planning gas per transaction on a chain, in USD, at the snapshot date. */
function gasUsd(chain: string): number {
  switch (chain) {
    case 'Ethereum':
      return 3.0;
    case 'Bitcoin':
      return 1.5;
    case 'Tron':
      return 0.5;
    case 'Avalanche':
      return 0.3;
    case 'Binance':
      return 0.15;
    case 'Arbitrum':
      return 0.1;
    case 'Base':
    case 'Optimism':
    case 'Polygon':
    case 'Hyperliquid L1':
      return 0.05;
    case 'Solana':
    case 'Sui':
      return 0.02;
    default:
      return 0.5;
  }
}

function money(n: number): string {
  return `$${n}`;
}

interface CategoryPlay {
  main: string;
  second: string;
  weekly: string;
}

const PLAYS: Record<string, CategoryPlay> = {
  Lending: {
    main: 'Supply {cap} of assets to {name} lending market',
    second: 'Borrow a small amount against the supplied collateral',
    weekly: 'Top up, repay or adjust the supplied position',
  },
  Dexs: {
    main: 'Add {cap} of liquidity to one of {name} pools',
    second: 'Swap through {name} router so the address records trading volume',
    weekly: 'Route one small swap through the router',
  },
  Yield: {
    main: 'Deposit {cap} into one of {name} yield vaults',
    second: 'Move part of the deposit into a second vault or stake the receipt token',
    weekly: 'Harvest or compound the vault yield',
  },
  RWA: {
    main: 'Deposit {cap} into {name} tokenised-asset vault',
    second: 'Hold the receipt token and use the protocol secondary market or governance',
    weekly: 'Check the position accrued yield and top it up',
  },
  Derivatives: {
    main: 'Open a small hedged position on {name} derivatives market',
    second: 'Provide liquidity to the market liquidity pool',
    weekly: 'Rebalance or roll the open position',
  },
  CDP: {
    main: 'Lock collateral and mint {cap} of {name} stablecoin',
    second: 'Repay part of the debt, then mint again to show repeat use',
    weekly: 'Adjust the collateral ratio back toward the target',
  },
  'Yield Aggregator': {
    main: 'Deposit {cap} into one of {name} strategy vaults',
    second: 'Shift part of the funds into a second strategy',
    weekly: 'Rebalance between the strategies',
  },
  'Basis Trading': {
    main: 'Deposit {cap} into {name} basis-trading vault',
    second: 'Add liquidity to the strategy funding pool',
    weekly: 'Check the funding rate and rebalance',
  },
  'Risk Curators': {
    main: 'Allocate {cap} to one of {name} curator vaults',
    second: 'Spread a second allocation across another curator vault',
    weekly: 'Review curator performance and reallocate',
  },
  'Onchain Capital Allocator': {
    main: 'Deposit {cap} into one of {name} allocation vaults',
    second: 'Allocate a second tranche to a different strategy',
    weekly: 'Review allocations and rebalance',
  },
  Chain: {
    main: 'Bridge {cap} onto {chain} and use {name} flagship app',
    second: 'Try a second native app on the same chain',
    weekly: 'Make one on-chain transaction on the chain',
  },
  'Staking Pool': {
    main: 'Stake {cap} in {name} staking pool',
    second: 'Restake the staking rewards back into the pool',
    weekly: 'Claim and restake the week rewards',
  },
  'Liquidity Manager': {
    main: 'Deposit {cap} into a {name}-managed liquidity position',
    second: 'Open a second managed position in another pool',
    weekly: 'Rebalance the managed position',
  },
  Restaking: {
    main: 'Restake {cap} through {name} restaking vault',
    second: 'Delegate the restaked position to a second operator',
    weekly: 'Check restaking rewards and top up',
  },
  'Leveraged Farming': {
    main: 'Open a {cap} leveraged farming position on {name}',
    second: 'Open a second, smaller leveraged position in another pool',
    weekly: 'Monitor the health factor and deleverage if needed',
  },
  'Prediction Market': {
    main: 'Place {cap} of small prediction trades on {name} markets',
    second: 'Provide liquidity to a prediction market pool',
    weekly: 'Place one new prediction',
  },
  'Stablecoin Wrapper': {
    main: 'Mint or wrap {cap} through {name}',
    second: 'Use the wrapped token in a second protocol',
    weekly: 'Mint or redeem a small amount',
  },
  'Dual-Token Stablecoin': {
    main: 'Mint {cap} of the stablecoin through {name}',
    second: 'Use the minted token in a second protocol',
    weekly: 'Mint or redeem a small amount',
  },
  CeDeFi: {
    main: 'Deposit {cap} into {name} CeDeFi vault',
    second: 'Try the protocol second yield product',
    weekly: 'Review the vault yield and rebalance',
  },
  Farm: {
    main: 'Deposit {cap} into {name} farm',
    second: 'Stake the farm receipt token in a second pool',
    weekly: 'Harvest and compound the farm rewards',
  },
  'Uncollateralized Lending': {
    main: 'Lend {cap} through {name} credit market',
    second: 'Fund a second borrower pool',
    weekly: 'Review borrower performance and re-lend',
  },
  'Interest Rate Derivatives': {
    main: 'Open a {cap} interest-rate position on {name}',
    second: 'Provide liquidity to the rate market',
    weekly: 'Roll or adjust the rate position',
  },
  'Cross Chain Bridge': {
    main: 'Bridge {cap} across chains through {name}',
    second: 'Bridge a second, smaller amount on another route',
    weekly: 'Bridge one small transfer',
  },
  'CDP Manager': {
    main: 'Manage a {cap} CDP position through {name}',
    second: 'Open a second CDP in another collateral type',
    weekly: 'Adjust collateral ratios',
  },
  'OTC Marketplace': {
    main: 'Complete a {cap} OTC trade on {name}',
    second: 'List a second small OTC offer',
    weekly: 'Check new OTC listings',
  },
  Insurance: {
    main: 'Buy {cap} of cover on {name}',
    second: 'Provide capital to a second cover pool',
    weekly: 'Review active cover and renew as needed',
  },
  Payments: {
    main: 'Route {cap} of payments through {name}',
    second: 'Use the protocol second payment rail',
    weekly: 'Send one payment',
  },
  'Governance Incentives': {
    main: 'Lock {cap} in {name} governance program',
    second: 'Vote on a second proposal',
    weekly: 'Vote on the week new proposal',
  },
  'Crypto Card Issuer': {
    main: 'Top up {cap} on the {name} card and spend it',
    second: 'Use the card for a second purchase category',
    weekly: 'Make one card purchase',
  },
  Indexes: {
    main: 'Buy {cap} of {name} index token',
    second: 'Mint a second index allocation',
    weekly: 'Rebalance the index holding',
  },
  'Collateral Markets': {
    main: 'Supply {cap} of collateral to {name} market',
    second: 'Borrow against the collateral in a second market',
    weekly: 'Adjust the collateral position',
  },
  'Anchor BTC': {
    main: 'Deposit {cap} of BTC-linked assets into {name}',
    second: 'Use the receipt token in a second DeFi position',
    weekly: 'Top up or rebalance the BTC position',
  },
  'Decentralized BTC': {
    main: 'Deposit {cap} of BTC-linked assets into {name}',
    second: 'Use the receipt token in a second DeFi position',
    weekly: 'Top up or rebalance the BTC position',
  },
};

const GENERIC_PLAY: CategoryPlay = {
  main: 'Use {name} main product with {cap}',
  second: 'Try a second feature of the same product',
  weekly: 'Return and use the product once more',
};

/** Fill {cap}, {name} and {chain} in a play template. */
function fill(template: string, cap: string, name: string, chain: string): string {
  return template.replaceAll('{cap}', cap).replaceAll('{name}', name).replaceAll('{chain}', chain);
}

/**
 * Seven concrete farm steps for one protocol, each 20–600 characters, each
 * with a cost and a time. Capital follows the protocol's TVL tier; gas is a
 * planning estimate for its main chain; the hold length follows its age.
 */
export function farmSteps(snapshot: Snapshot, p: SnapshotProtocol): string[] {
  const capital = p.tvl_usd >= 5_000_000_000 ? 250 : p.tvl_usd >= 1_000_000_000 ? 150 : p.tvl_usd >= 100_000_000 ? 100 : 50;
  const half = capital / 2;
  const chain = p.chains[0] ?? 'Ethereum';
  const gas = gasUsd(chain).toFixed(2);
  const age = ageDays(snapshot, p);
  const hold = age === null || (age >= 180 && age <= 365) ? 60 : age < 180 ? 90 : 45;
  const ageNote =
    age === null
      ? 'its listing date is not in the snapshot'
      : age < 180
        ? `it has run only ${age} days with no token`
        : age <= 365
          ? `it has run ${age} days with no token`
          : `it has run ${age} days with no token`;
  const play = p.category !== null && PLAYS[p.category] !== undefined ? PLAYS[p.category]! : GENERIC_PLAY;
  return [
    `Set up a fresh wallet that holds only the farm funds for ${p.name}; write the seed phrase on paper and store it offline, never in a screenshot or chat. Cost: $0, one-time setup, about 15 minutes.`,
    `${fill(play.main, money(capital), p.name, chain)}. Capital: ${money(capital)}; estimated gas about $${gas} per transaction on ${chain}; allow 30 minutes.`,
    `${fill(play.second, money(half), p.name, chain)}. Capital: ${money(half)}; estimated gas about $${gas} per transaction on ${chain}; allow 30 minutes.`,
    `${fill(play.weekly, money(half), p.name, chain)} every week, so the address shows steady use instead of a single burst. Cost: about $${gas} in gas per week, 10 minutes a week.`,
    `Keep the main position open for at least ${hold} days — ${ageNote}. Withdrawing early can erase the farming history. Cost: $0 beyond the locked capital.`,
    `When a token launches, claim only from the link ${p.name} itself publishes on its own site or official account; never pay a fee to claim, and never connect a wallet from a link in a direct message. Cost: one claim transaction, about $${gas}.`,
    `Write down the wallet address, every deposit date and amount, and every transaction hash in one note, so the claim can be proven later. Cost: $0, 5 minutes after each action.`,
  ];
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

/** Score every rankable protocol and rank them by implied value, ties by slug. */
export function buildRadar(snapshot: Snapshot, calibration: Calibration): Radar {
  const watchlist = new Set(snapshot.watchlist);
  const ranked = snapshot.protocols.filter(isRankable);
  const rows: BoardRow[] = ranked
    .map((p) => {
      const f = factors(snapshot, calibration, p);
      return {
        slug: p.slug,
        name: p.name,
        rank: 0,
        implied_value_usd: impliedValue(p, f),
        farm_steps: farmSteps(snapshot, p),
        category: p.category,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        age_days: ageDays(snapshot, p),
        chain_count: p.chains.length,
        main_chain: p.chains[0] ?? 'Ethereum',
        watchlist: watchlist.has(p.slug),
        factors: {
          category_multiple: Math.round(f.category_multiple * 10000) / 10000,
          growth: Math.round(f.growth * 10000) / 10000,
          maturity: Math.round(f.maturity * 10000) / 10000,
          breadth: Math.round(f.breadth * 10000) / 10000,
        },
      };
    })
    .sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });
  const live = snapshot.protocols.filter((p) => !recordsNoToken(p)).length;
  return {
    rows,
    watchlist_size: snapshot.watchlist.length,
    early_size: rows.filter((r) => !r.watchlist).length,
    live_size: live,
    calibration,
    as_of: snapshot.as_of,
  };
}

/**
 * The gate's own board checks, run before anything is written: row count,
 * slugs from the snapshot, ranks exactly 1..N, implied values non-increasing
 * and not all equal, full watchlist coverage, farm steps 3–12 of 20–600 chars.
 * Returns the first problem, or null when the board is valid.
 */
export function boardIssue(rows: BoardRow[], snapshot: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 4000) return `board holds ${rows.length} rows, the gate wants 100–4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  let allEqual = rows.length > 1;
  for (const row of rows) {
    if (!known.has(row.slug)) return `row names ${row.slug}, which the snapshot does not list`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank < 1 || !Number.isInteger(row.rank)) return `row ${row.slug} has rank ${row.rank}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1) {
      return `row ${row.slug} has implied value ${row.implied_value_usd}`;
    }
    if (row.implied_value_usd > previous) return `implied value rises at rank ${row.rank}`;
    if (row.implied_value_usd !== previous && previous !== Number.POSITIVE_INFINITY) allEqual = false;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} has ${row.farm_steps.length} farm steps`;
    }
    for (const step of row.farm_steps) {
      const n = step.trim().length;
      if (n < 20 || n > 600) return `row ${row.slug} has a farm step of ${n} characters`;
    }
  }
  const ranks = new Set(rows.map((r) => r.rank));
  if (ranks.size !== rows.length) return 'ranks are not unique';
  for (let i = 1; i <= rows.length; i++) {
    if (!ranks.has(i)) return `rank ${i} is missing`;
  }
  if (allEqual) return 'every implied value is the same, so the board ranks nothing';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Backtest: leave-one-out on the snapshot's own live-token protocols.
// ---------------------------------------------------------------------------

export interface Backtest {
  comparables: number;
  calibrated_median_abs_log_error: number;
  calibrated_mean_abs_log_error: number;
  flat_025_median_abs_log_error: number;
  flat_025_mean_abs_log_error: number;
  full_formula_median_abs_log_error: number;
  full_formula_mean_abs_log_error: number;
}

function absLogError(predicted: number, actual: number): number {
  return Math.abs(Math.log(predicted / actual));
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * For each comparable, predict its market cap from its TVL with the multiple
 * fitted WITHOUT it (its category's median of the others when at least 5
 * remain, else the overall median of the others), and score three predictors:
 * the calibrated multiple, a flat 0.25, and the full formula.
 */
export function backtestCalibration(snapshot: Snapshot): Backtest {
  const comps = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX',
  );
  const calibrated: number[] = [];
  const flat: number[] = [];
  const full: number[] = [];
  for (const target of comps) {
    const others = comps.filter((p) => p !== target);
    const overall = median(others.map((p) => p.mcap_usd! / p.tvl_usd));
    const sameCat = others.filter((p) => p.category === target.category);
    const multiple =
      sameCat.length >= 5
        ? Math.min(median(sameCat.map((p) => p.mcap_usd! / p.tvl_usd)), 1.0)
        : Math.min(overall, 1.0);
    calibrated.push(absLogError(target.tvl_usd * multiple, target.mcap_usd!));
    flat.push(absLogError(target.tvl_usd * 0.25, target.mcap_usd!));
    const f = factors(snapshot, { overall_median: overall, category_medians: {}, category_counts: {}, comparables: others.length }, target);
    const fullMultiple = sameCat.length >= 5
      ? Math.min(median(sameCat.map((p) => p.mcap_usd! / p.tvl_usd)), 1.0)
      : Math.min(overall, 1.0);
    full.push(
      absLogError(
        target.tvl_usd * fullMultiple * f.growth * f.maturity * f.breadth,
        target.mcap_usd!,
      ),
    );
  }
  return {
    comparables: comps.length,
    calibrated_median_abs_log_error: median(calibrated),
    calibrated_mean_abs_log_error: mean(calibrated),
    flat_025_median_abs_log_error: median(flat),
    flat_025_mean_abs_log_error: mean(flat),
    full_formula_median_abs_log_error: median(full),
    full_formula_mean_abs_log_error: mean(full),
  };
}

// ---------------------------------------------------------------------------
// Dashboard data
// ---------------------------------------------------------------------------

/** The data.js the dashboard page reads: the board plus the calibration. */
export function dataScript(radar: Radar, backtest: Backtest): string {
  const payload = {
    model: 'radar-3',
    as_of: radar.as_of,
    rows_total: radar.rows.length,
    watchlist_size: radar.watchlist_size,
    early_size: radar.early_size,
    live_size: radar.live_size,
    overall_median: Math.round(radar.calibration.overall_median * 10000) / 10000,
    category_medians: radar.calibration.category_medians,
    category_counts: radar.calibration.category_counts,
    comparables: radar.calibration.comparables,
    backtest: {
      comparables: backtest.comparables,
      calibrated_median: Math.round(backtest.calibrated_median_abs_log_error * 1000) / 1000,
      flat_median: Math.round(backtest.flat_025_median_abs_log_error * 1000) / 1000,
      full_median: Math.round(backtest.full_formula_median_abs_log_error * 1000) / 1000,
    },
    rows: radar.rows,
  };
  return `window.TOKEN_RADAR = ${JSON.stringify(payload)};\n`;
}
