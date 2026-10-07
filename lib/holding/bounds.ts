import type { Config, Landlord, Receipt } from "./types.ts";

const DAY = 86400n;
const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const min = (a: bigint, b: bigint) => a < b ? a : b;
const positive = (n: bigint) => n > 0n ? n : 0n;

/** Match Config::allowance_count_is_current across an open daily count. */
export function allowanceCountIsCurrent(config: Config, landlord: Landlord) {
  if (landlord.attestation_epoch !== config.refresher_epoch || landlord.counted_round === 0n) return false;
  if (config.count.open && landlord.counted_round === config.count.round) return true;
  const completedRound = positive(config.count.round - (config.count.open ? 1n : 0n));
  return config.last_count_at !== 0n && landlord.counted_round === completedRound;
}

/** Match Config::carry_floor and Landlord::settle, including Rust saturation. */
export function rewardAllowance(config: Config, landlord: Landlord, now: bigint) {
  if (!allowanceCountIsCurrent(config, landlord)) return 0n;
  const marks = config.reward_marks.filter(m => m.at !== 0n && m.at > now - 3n * DAY && m.at <= now);
  const floor = marks.reduce((n, m) => min(n, m.index), config.reward_index);
  // Allowance accrues on the counted coin, less anything a later read found gone.
  const earning = landlord.snapshot_valid ? min(landlord.counted_amount, landlord.snapshot) : 0n;
  const earned = (delta: bigint) => {
    const product = earning * positive(delta);
    return product > U128_MAX ? U64_MAX : min(product / 1_000_000_000_000n, U64_MAX);
  };
  return min(min(landlord.allowance + earned(config.reward_index - landlord.index_at), U64_MAX),
    earned(config.reward_index - floor));
}

/** Config v4 never extends expiry: even an indefinite stop leaves refunds live. */
export function refundDeadline(receipt: Receipt, config: Config) {
  if (config.version !== 4) throw new Error("Refund timing requires Config v4");
  return receipt.refund_at;
}
