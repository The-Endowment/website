import assert from "node:assert/strict";
import { test } from "node:test";
import { rewardAllowance, refundDeadline } from "../lib/holding/bounds.ts";
import type { Config, Landlord, Receipt } from "../lib/holding/types.ts";
const DAY = 86400n, SCALE = 1_000_000_000_000n;
const config = () => ({ reward_index: 100n * SCALE, reward_marks: [{ at: DAY, index: 0n }],
  pause_started_at: 0n, paused_until: 0n } as Config);
const landlord = () => ({ index_at: 0n, allowance: 0n, counted_amount: 1n } as Landlord);
test("posted credit expires at 72 elapsed hours despite a posting outage", () => {
  const c = config(), l = landlord();
  assert.equal(rewardAllowance(c, l, 4n * DAY - 1n), 100n);
  assert.equal(rewardAllowance(c, l, 4n * DAY), 0n);
  l.index_at = c.reward_index; l.allowance = 100n;
  assert.equal(rewardAllowance(c, l, 8n * DAY), 0n);
  c.reward_marks = [{ at: 8n * DAY, index: c.reward_index }];
  c.reward_index += 20n * SCALE;
  assert.equal(rewardAllowance(c, l, 8n * DAY), 20n);
  l.counted_amount = 0n;
  assert.equal(rewardAllowance(c, l, 8n * DAY), 0n);
});
test("allowance does not restore credit already spent and saturates like Rust", () => {
  const c = config(), l = landlord();
  l.index_at = c.reward_index; l.allowance = 15n;
  assert.equal(rewardAllowance(c, l, 2n * DAY), 15n);
  c.reward_index = (1n << 128n) - 1n; l.counted_amount = (1n << 64n) - 1n;
  assert.equal(rewardAllowance(c, l, 2n * DAY), (1n << 64n) - 1n);
});
test("a live pause extends review but a pause at or after expiry cannot reopen it", () => {
  const r = { collected_at: DAY, release_at: 2n * DAY, refund_at: 4n * DAY } as Receipt;
  const c = config();
  assert.equal(refundDeadline(r, c), 4n * DAY);
  c.pause_started_at = 3n * DAY; c.paused_until = 8n * DAY;
  assert.equal(refundDeadline(r, c), 10n * DAY);
  c.pause_started_at = 4n * DAY;
  assert.equal(refundDeadline(r, c), 4n * DAY);
  c.pause_started_at += 1n;
  assert.equal(refundDeadline(r, c), 4n * DAY);
});
