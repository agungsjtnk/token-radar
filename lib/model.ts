// Token Radar's model: one sealed DefiLlama snapshot in, one ranked board of pre-token protocols out.
//
// WHO IS RANKED. Every protocol the snapshot records with no token (no market cap, no CoinGecko id,
// no symbol) that is not a wrapped, staked or bridged product of a token that already trades: its
// category is not Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX,
// its name carries no whole word wrapped, staked or staking, does not open with an exchange's name
// and does not end in a version marker. That is the watchlist's own rule applied to the whole index,
// so the snapshot's watchlist is covered by construction, and the board runs past its $50M floor to
// every qualifying protocol in the snapshot. Protocols whose token already trades are never ranked:
// they are carried apart, at the market's own market cap.
//
// WHAT A TOKEN WOULD BE WORTH. Three of the snapshot's own figures, and a yardstick the snapshot
// itself supplies:
//
//   baseMultiple  the median market-cap / TVL ratio of the snapshot's own tokenised protocols
//                 (exchanges and chains left out: their ratios price a different business).
//                 The market's own answer to "what is a dollar of TVL worth as a token?".
//   growthMult    1 + 0.9 x tanh(clamp(change_7d, -50, 150) / 45): a hot week lifts the value,
//                 a cold one cuts it, and tanh keeps one wild week from swamping the board.
//   maturityMult  0.55 + 0.65 x (1 - exp(-age_days / 620)): the longer a protocol has run with
//                 no token, the more of its record is proven; the lift saturates near three years.
//                 An unlisted age scores at the ranked set's own median age.
//   implied       max(1, round(tvl_usd x baseMultiple x growthMult x maturityMult))
//
// No protocol's name is ever special-cased: one function scores every row, and the dashboard
// recomputes each row from the same figures so page and board cannot drift apart.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's fixed shape; the base multiple itself is measured from the snapshot at run time. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  growth_scale: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_scale_days: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.9,
  growth_floor: -50,
  growth_cap: 150,
  growth_scale: 45,
  maturity_floor: 0.55,
  maturity_range: 0.65,
  maturity_scale_days: 620,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one ranked row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  /** The same strings board.json carries, so the page shows the board's own plan, never a second derivation. */
  farm_steps: string[];
}

/** A protocol whose token already trades: shown at the market's own value, never the model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  symbol: string | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  base_multiple: number;
  calibration_size: number;
  unknown_age_days: number;
  universe_size: number;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers, the list sorted in place by the caller. */
function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The base multiple, measured from the snapshot itself: the median market-cap-to-TVL ratio of the
 * protocols whose token already trades, exchanges and chains excluded. Falls back to 0.2 (near this
 * snapshot's measured value) if a snapshot ever carried no usable live protocol.
 */
export function baseMultiple(snapshot: Snapshot): { multiple: number; calibrationSize: number } {
  const ratios: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    if (p.category === 'CEX' || p.category === 'Chain') continue;
    ratios.push(p.mcap_usd / p.tvl_usd);
  }
  if (ratios.length === 0) return { multiple: 0.2, calibrationSize: 0 };
  ratios.sort((a, b) => a - b);
  return { multiple: median(ratios), calibrationSize: ratios.length };
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product of a token that already trades, or an exchange. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a product may open with. */
const EXCHANGE_HEADS = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * Whether a protocol is one the board may rank: it records no token, and it is not a wrapped, staked
 * or bridged product of one that trades. This is the watchlist's rule, so every watchlist slug passes.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  if (EXCHANGE_HEADS.some((head) => p.name.startsWith(head))) return false;
  if (VERSIONED.test(p.name)) return false;
  return true;
}

/** The three multipliers and the implied value one protocol gets. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  base: number,
  unknownAgeDays: number,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const growthMult = 1 + model.growth_weight * Math.tanh(growthPct / model.growth_scale);
  const ageForModel = age ?? unknownAgeDays;
  const maturityMult = model.maturity_floor + model.maturity_range * (1 - Math.exp(-Math.max(ageForModel, 0) / model.maturity_scale_days));
  const implied = Math.max(1, Math.round(protocol.tvl_usd * base * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/* ------------------------------------------------------------------ farm plans */

/** What one chain costs to use, and the wallet a farmer opens on it: the plan's chain facts. */
interface ChainProfile {
  fee: string;
  wallet: string;
  /** Lower is cheaper to route through; picks the plan's working chain out of a protocol's chains. */
  costRank: number;
}

const L2_CHAINS = new Set([
  'Arbitrum', 'Base', 'Optimism', 'zkSync Era', 'Linea', 'Scroll', 'Mantle', 'Blast', 'Mode', 'Taiko',
  'Ink', 'Unichain', 'Soneium', 'BOB', 'Mint', 'Zircuit', 'Manta', 'Fraxtal', 'World Chain', 'Sonic',
  'Berachain', 'Abstract', 'Corn', 'Plume Mainnet', 'Hemi', 'Lens', 'X Layer', 'Polygon zkEVM', 'Starknet',
]);

function chainProfile(chain: string): ChainProfile {
  if (chain === 'Ethereum') return { fee: 'about $8 of ETH in gas', wallet: 'an EVM wallet such as Rabby or MetaMask', costRank: 4 };
  if (L2_CHAINS.has(chain)) return { fee: 'under $1 of ETH in gas', wallet: 'an EVM wallet such as Rabby or MetaMask', costRank: 1 };
  if (chain === 'Solana') return { fee: 'a few cents of SOL in transaction fees', wallet: 'a Solana wallet such as Phantom', costRank: 1 };
  if (chain === 'Binance' || chain === 'BSC') return { fee: 'about $0.30 of BNB in gas', wallet: 'an EVM wallet such as Rabby or MetaMask', costRank: 1 };
  if (chain === 'Bitcoin') return { fee: 'one Bitcoin network fee, roughly $1-5', wallet: 'a Bitcoin wallet such as Xverse', costRank: 3 };
  if (chain === 'Tron') return { fee: 'about $1 of TRX in fees', wallet: 'a Tron wallet such as TronLink', costRank: 2 };
  if (chain === 'Sui') return { fee: 'a few cents of SUI in gas', wallet: 'a Sui wallet such as Slush', costRank: 1 };
  if (chain === 'Aptos') return { fee: 'a few cents of APT in gas', wallet: 'an Aptos wallet such as Petra', costRank: 1 };
  if (chain === 'Near') return { fee: 'a few cents of NEAR in gas', wallet: 'a NEAR wallet such as Meteor', costRank: 1 };
  if (chain === 'Bittensor') return { fee: 'a few cents of TAO in fees', wallet: 'a Bittensor wallet such as Talisman', costRank: 1 };
  if (chain === 'Polygon' || chain === 'Avalanche' || chain === 'Fantom' || chain === 'Gnosis' || chain === 'Celo') {
    return { fee: 'a few cents of gas on ' + chain, wallet: 'an EVM wallet such as Rabby or MetaMask', costRank: 1 };
  }
  return { fee: 'about $1-3 of gas on ' + chain, wallet: 'the wallet ' + chain + ' apps name first, usually Rabby or the chain\u2019s own wallet', costRank: 2 };
}

/** The chain the plan works on: the cheapest of the protocol's chains to transact on, list order breaking ties. */
function workingChain(p: SnapshotProtocol): string {
  let best = p.chains[0] ?? 'its main chain';
  let bestRank = Number.POSITIVE_INFINITY;
  for (const chain of p.chains) {
    const rank = chainProfile(chain).costRank;
    if (rank < bestRank) {
      bestRank = rank;
      best = chain;
    }
  }
  return best;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core position and its weekly qualifying action, in words a farmer can follow. */
function categoryActions(p: SnapshotProtocol, capital: number, chain: string): { act: string; weekly: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('dex')) return {
    act: `Add $${capital} of liquidity to ${name}'s busiest pool on ${chain}, split evenly between the pool's two assets, and keep the LP position open.`,
    weekly: `Route one swap of about $25 through ${name} each week, alternating the pair you trade so the wallet shows real use, not one repeated click.`,
  };
  if (c.includes('lend')) return {
    act: `Supply $${capital} of USDC to ${name} on ${chain} as collateral, then borrow about 40% of it once and repay within the week so the wallet records a full lend-borrow cycle.`,
    weekly: `Top the collateral up or repay a slice each week, keeping the health factor comfortably above the app's warning line.`,
  };
  if (c.includes('cdp')) return {
    act: `Open a vault on ${name} on ${chain}: deposit about $${Math.round(capital * 1.5)} of collateral and mint roughly $${capital} of its stablecoin against it, well inside the liquidation line.`,
    weekly: `Adjust the vault once a week - repay a little minted stablecoin or add collateral - and never let the collateral ratio drift near liquidation.`,
  };
  if (c.includes('derivative') || c.includes('perpetual')) return {
    act: `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small position, no more than 2x, hedged or closed the same day so the farm is the activity, not the bet.`,
    weekly: `Open and close one small trade a week on ${name}, keeping total volume steady; perps points usually count trades and open interest, not profit.`,
  };
  if (c.includes('curator') || c.includes('allocator') || c.includes('collateral')) return {
    act: `Deposit $${capital} of USDC into a ${name} vault on ${chain} - pick the vault whose curator publishes its strategy - and keep the vault shares in the wallet.`,
    weekly: `Read the curator's weekly update inside the app and move nothing unless the vault's strategy changes; one small top-up a month keeps the position current.`,
  };
  if (c.includes('basis')) return {
    act: `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain}; the vault runs the hedge, so your job is to hold the shares through full funding cycles.`,
    weekly: `Check the vault's reported funding yield once a week and log it; add $25 only if the yield has stayed positive for two straight weeks.`,
  };
  if (c.includes('rwa')) return {
    act: `Complete ${name}'s onboarding on ${chain} (some RWA apps ask for KYC: budget 20 minutes and a photo ID), then mint $${capital} of its yield-bearing asset and hold it.`,
    weekly: `Claim or compound the yield the app credits each week and keep the claim receipts; RWA rewards usually follow holders of record.`,
  };
  if (c.includes('yield') || c.includes('farm')) return {
    act: `Deposit $${capital} into ${name}'s main vault on ${chain} and leave the vault shares untouched; if the app offers a boosted tier for holding, take the longest one you can afford.`,
    weekly: `Harvest or compound the vault's rewards once a week, whichever the app makes cheaper in gas, and log the amount each time.`,
  };
  if (c.includes('staking') || c.includes('restak')) return {
    act: `Stake $${capital} of the chain's asset through ${name} on ${chain} and keep the staking receipt token in the same wallet, unstaked and unspent.`,
    weekly: `Claim staking rewards once a week and restake them in the same visit, so the wallet shows continuous, compounding stake.`,
  };
  if (c.includes('launchpad')) return {
    act: `Register the wallet on ${name} on ${chain}, complete any allowlist task it lists, and take part in one sale with about $${capital}, sized so a locked vesting schedule cannot hurt.`,
    weekly: `Check ${name}'s upcoming-sales page once a week and join one sale a month at most; launchpad tiers usually count participation over time.`,
  };
  if (c.includes('prediction')) return {
    act: `Fund $${capital} on ${name} on ${chain} and place two or three small positions on liquid markets, sized so being wrong costs a few dollars, not the stake.`,
    weekly: `Settle finished markets and place one new position a week; prediction platforms count settled markets and consistent activity.`,
  };
  if (c.includes('chain')) return {
    act: `Bridge $${capital} to ${chain} itself and use two of its native apps in the first week - one swap and one deposit - so the wallet is a real citizen of the chain, not a passer-by.`,
    weekly: `Make one transaction a week on ${name}'s chain - a swap, a vote or a small transfer between your own wallets - and keep a small gas balance there at all times.`,
  };
  if (c.includes('privacy')) return {
    act: `Deposit $${capital} into ${name} on ${chain} and make one shielded transfer to your own second address, following the app's own guide for note-keeping.`,
    weekly: `Make one small shielded transfer a week and keep the notes backed up; privacy pools reward time in the pool, so do not rush withdrawals.`,
  };
  if (c.includes('index')) return {
    act: `Mint $${capital} of ${name}'s index on ${chain} and hold the index token; minting, not buying on a secondary market, is what the protocol itself records.`,
    weekly: `Check the index composition once a week and mint or redeem a small slice monthly so the wallet shows both sides of the product.`,
  };
  if (c.includes('synthetic')) return {
    act: `Mint about $${capital} of ${name}'s synthetic asset on ${chain} against at least twice that in collateral, and park the synthetic in the app's own pool if it offers one.`,
    weekly: `Watch the collateral ratio weekly and top up before it nears the liquidation line; one adjustment a week is the whole job.`,
  };
  if (c.includes('locker')) return {
    act: `Lock a small position - about $${capital} of LP tokens from a pool you already use - through ${name} on ${chain} for the longest term on offer.`,
    weekly: `Claim the locker rewards weekly and extend the lock once if the app pays a bonus for it; keep the unlock date in your farm log.`,
  };
  if (c.includes('stablecoin')) return {
    act: `Mint $${capital} of ${name}'s stablecoin on ${chain} against its accepted collateral, then hold or deposit the stablecoin inside the same app.`,
    weekly: `Mint or repay a small slice each week so both sides of the stablecoin appear in the wallet's history.`,
  };
  if (c.includes('btc')) return {
    act: `Move about $${capital} of BTC to ${chain} through the route ${name}'s own app names, then deposit it in the app's main vault and keep the receipt.`,
    weekly: `Check the vault balance weekly and add a small top-up monthly; BTC routes are slow and pricey, so batch every action.`,
  };
  if (c.includes('liquidity')) return {
    act: `Deposit $${capital} into ${name}'s managed vault on ${chain}; the manager keeps the position in range, and your shares are the proof of farming.`,
    weekly: `Review the vault's range report weekly and top up $25 when the vault has stayed in range for a fortnight.`,
  };
  return {
    act: `Deposit $${capital} of USDC into ${name} on ${chain} through its main app and keep the position open; if the app offers several products, use the one its own front page leads with.`,
    weekly: `Make one qualifying action a week inside ${name} - a deposit, a withdrawal of a slice, or a claim - so the wallet never looks dormant.`,
  };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: { text: string; cost: string; time: string }): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, derived from the
 * protocol's own record - its category picks the actions, its chains pick the wallet, the gas and
 * the working chain, its TVL sizes the position and its age sets the hold. No name is special-cased.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = workingChain(p);
  const profile = chainProfile(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const { act, weekly } = categoryActions(p, capital, chain);
  const multi = p.chains.length > 1 && p.chains[0] !== chain;
  const steps = [
    {
      text: `Open ${profile.wallet} dedicated to this farm, fund it on ${chain}, and keep its seed phrase offline; never farm from a wallet that holds your main funds.`,
      cost: `${profile.fee} to make the wallet live`,
      time: '10 minutes',
    },
    multi
      ? {
          text: `${p.name} runs on ${p.chains.length} chains; work on ${chain}, the cheapest of them to transact on, and bridge only the $${capital} you plan to farm - the same position on ${p.chains[0]} would cost more in gas for the same credit.`,
          cost: 'one bridge fee, usually under $5',
          time: '15 minutes including the wait for the bridge',
        }
      : {
          text: `Bring exactly the capital for this farm - $${capital} plus a gas buffer - into the wallet on ${chain}; leave the rest of your funds out of it.`,
          cost: `${profile.fee} for the funding transaction`,
          time: '10 minutes',
        },
    { text: act, cost: `$${capital} of capital plus ${profile.fee}`, time: '15-20 minutes to set up' },
    { text: weekly, cost: `${profile.fee} a week`, time: '10 minutes a week' },
    {
      text: `Open ${p.name}'s own points or rewards page from inside its app - never from a search result or a message - and confirm this wallet is the one being counted before you add another dollar.`,
      cost: 'nothing to check, and never pay anyone to claim for you',
      time: '10 minutes',
    },
    {
      text: `Hold the position for at least ${hold} days, so the activity spans more than one weekly snapshot of the protocol; short in-and-out visits are the pattern points programs discount first.`,
      cost: `the $${capital} stays in the position for the whole ${hold} days`,
      time: `${hold} days`,
    },
    {
      text: `Keep a farm log - wallet, chain, dates, amounts, transaction hashes - and when you unwind, withdraw through the same app screens you deposited through, checking the address on screen before you sign.`,
      cost: 'nothing but the log itself',
      time: '5 minutes to start, 2 minutes a visit',
    },
  ];
  return steps.map(stepText);
}

/* ------------------------------------------------------------------ the board */

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; base: number; calibrationSize: number; unknownAgeDays: number } {
  const { multiple: rawMultiple, calibrationSize } = baseMultiple(snapshot);
  // The multiple is rounded to six places before it scores anything, so the dashboard - which is
  // handed this same number - recomputes every row to the board's exact figure.
  const multiple = Math.round(rawMultiple * 1e6) / 1e6;
  const ranked = snapshot.protocols.filter(isRankable);
  const knownAges = ranked.map((p) => ageDays(snapshot.as_of, p.listed_at)).filter((a): a is number => a !== null).sort((a, b) => a - b);
  const unknownAgeDays = knownAges.length > 0 ? Math.round(median(knownAges)) : 365;
  const watchlist = new Set(snapshot.watchlist);
  const scored = ranked.map((p) => ({ p, ...impliedValue(p, snapshot.as_of, model, multiple, unknownAgeDays) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    watchlist: watchlist.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: round4(multiple),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
  return { board, base: multiple, calibrationSize, unknownAgeDays };
}

/** The protocols whose token already trades, by market cap: set aside, at the market's own values. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? -1) - (a.mcap_usd ?? -1) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      symbol: p.symbol,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: row.watchlist,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, base, calibrationSize, unknownAgeDays } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    base_multiple: base,
    calibration_size: calibrationSize,
    unknown_age_days: unknownAgeDays,
    universe_size: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows: the gate takes 100 to 4,000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears on the board twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.name.length === 0) return `${r.slug} has an empty name`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
