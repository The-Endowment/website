import type { Config, Landlord, Receipt } from "./types.ts";

const DAY = 86400n;
const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const min = (a: bigint, b: bigint) => a < b ? a : b;
const positive = (n: bigint) => n > 0n ? n : 0n;

/** Match Config::carry_floor and Landlord::settle, including Rust saturation. */
export function rewardAllowance(config: Config, landlord: Landlord, now: bigint) {
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

/** A pause may extend a live receipt, but cannot reopen an expired one. */
export function refundDeadline(receipt: Receipt, config: Config) {
  const start = config.pause_started_at, end = config.paused_until;
  return start >= receipt.collected_at && start < receipt.refund_at && end > receipt.collected_at
    ? (receipt.refund_at > end + 2n * DAY ? receipt.refund_at : end + 2n * DAY)
    : receipt.refund_at;
}
