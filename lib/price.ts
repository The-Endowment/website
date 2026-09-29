/**
 * The pool's spot price and time-weighted average, read the way the program
 * reads them (`PoolView::reserve` and `twap_price_x32` in
 * programs/endowment/src/raydium.rs). The keeper logs these when a buy is
 * refused on price; the program's own reading is what decides.
 */

const OBSERVATION_NUM = 100;
const OBSERVATIONS_OFFSET = 43;
const OBSERVATION_LEN = 40;
const LAST_UPDATE_OFFSET = OBSERVATIONS_OFFSET + OBSERVATION_LEN * OBSERVATION_NUM;
/** Match `TWAP_WINDOW_SECONDS`, `MIN_TWAP_WINDOW_SECONDS`, `MAX_STRETCH_SHARE_BPS` and the +7 s record correction. */
const WINDOW = BigInt(1800);
const MIN_WINDOW = BigInt(900);
const STRETCH_SHARE_BPS = BigInt(2500);
const HALF_COALESCE = BigInt(7);
const Q32 = BigInt(32);

const u64At = (d: Uint8Array, o: number) => new DataView(d.buffer, d.byteOffset + o, 8).getBigUint64(0, true);
const u128At = (d: Uint8Array, o: number) => u64At(d, o) | (u64At(d, o + 8) << BigInt(64));
const MASK_128 = (BigInt(1) << BigInt(128)) - BigInt(1);

/** Protocol + fund + creator fees held in pool vault `index`, which aren't swappable (offsets from `PoolView::parse`). */
export function reservedFees(pool: Uint8Array, index: number) {
  return index === 0
    ? u64At(pool, 341) + u64At(pool, 357) + u64At(pool, 397)
    : u64At(pool, 349) + u64At(pool, 365) + u64At(pool, 405);
}

/** Coin per dividend at spot, Q32.32. */
export function spotPriceX32(reserveDividend: bigint, reserveCoin: bigint) {
  return reserveDividend > BigInt(0) ? (reserveCoin << Q32) / reserveDividend : null;
}

/** Coin per dividend over the recorded history, Q32.32, or null where the program would refuse. */
export function twapPriceX32(observation: Uint8Array, dividendIndex: number, now: bigint): bigint | null {
  if (observation.length !== 4075 || observation[8] === 0) return null;
  const latest = observation[9] | (observation[10] << 8);
  if (latest >= OBSERVATION_NUM) return null;
  const record = (i: number) => {
    const at = OBSERVATIONS_OFFSET + OBSERVATION_LEN * i;
    return [u64At(observation, at), u128At(observation, at + 8 + 16 * dividendIndex)] as const;
  };
  const [latestTs, latestCum] = record(latest);
  const lastUpdate = u64At(observation, LAST_UPDATE_OFFSET);
  const end = lastUpdate === BigInt(0) ? latestTs : lastUpdate;
  if (end < latestTs || end > now) return null;
  const cap = (WINDOW * STRETCH_SHARE_BPS) / BigInt(10_000);
  let [newerTs, newerTime, newerCum] = [latestTs, end, latestCum];
  let [weighted, weight, longest] = [BigInt(0), BigInt(0), BigInt(0)];
  for (let step = 1; step < OBSERVATION_NUM; step++) {
    const [ts, cum] = record((latest + OBSERVATION_NUM - step) % OBSERVATION_NUM);
    if (ts === BigInt(0) || ts >= newerTs) break;
    const time = ts + HALF_COALESCE < newerTime ? ts + HALF_COALESCE : newerTime;
    const seconds = newerTime - time;
    const delta = (newerCum - cum) & MASK_128;
    const secs = seconds > cap ? cap : seconds;
    weighted += seconds > cap ? (delta / seconds) * cap : delta;
    weight += secs;
    if (secs > longest) longest = secs;
    if (weight >= WINDOW) break;
    [newerTs, newerTime, newerCum] = [ts, time, cum];
  }
  const enough = weight >= WINDOW || (weight >= MIN_WINDOW && longest * BigInt(10_000) <= weight * STRETCH_SHARE_BPS);
  if (!enough || weight === BigInt(0)) return null;
  const twap = weighted / weight;
  return twap > BigInt(0) ? twap : null;
}

/** Spot's deviation from the TWAP in basis points (positive: more coin per dividend than the average). */
export function deviationBps(spot: bigint, twap: bigint) {
  return Number(((spot - twap) * BigInt(10_000)) / twap);
}

export const x32ToNumber = (v: bigint) => Number(v >> BigInt(16)) / 65_536;
