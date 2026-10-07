import assert from "node:assert/strict";
import { test } from "node:test";
import { assessWatch, LOW_FEE_LAMPORTS, type WatchInput } from "../lib/watch.ts";

const now = 1_800_000_000;
const H = 3600;
const healthy: WatchInput = {
  now, paused: false, closed: false, landlords: 3,
  lastCountAt: now - 20 * H, lastRewardPostAt: now - 10 * H,
  receipts: [{ collectedAt: now - 25 * H, amount: 100n }],
  balances: [{ role: "collector", address: "C", lamports: LOW_FEE_LAMPORTS }],
};
const codes = (w: WatchInput) => assessWatch(w).map((i) => i.code);

test("a healthy endowment, mid-hold collections included, raises nothing", () => {
  assert.deepEqual(assessWatch(healthy), []);
});

test("a pause is always flagged", () => {
  assert.deepEqual(codes({ ...healthy, paused: true }), ["paused"]);
});

test("collections held 30h are overdue, 72h are stuck, and the worse is reported once", () => {
  const overdue = assessWatch({ ...healthy, receipts: [{ collectedAt: now - 31 * H, amount: 5n }, { collectedAt: now - 2 * H, amount: 7n }] });
  assert.deepEqual(overdue, [{ code: "receipt_overdue", count: 1, amount: "5", oldestHours: 31 }]);
  const stuck = assessWatch({ ...healthy, receipts: [{ collectedAt: now - 80 * H, amount: 5n }, { collectedAt: now - 40 * H, amount: 7n }] });
  assert.deepEqual(stuck, [{ code: "receipt_stuck", count: 1, amount: "5", oldestHours: 80 }]);
});

test("missed reward posts and counts are flagged only while landlords are enrolled and it's open", () => {
  const late = { ...healthy, lastRewardPostAt: now - 40 * H, lastCountAt: 0 };
  assert.deepEqual(codes(late), ["reward_post_stale", "count_stale"]);
  assert.deepEqual(codes({ ...late, landlords: 0 }), []);
  assert.deepEqual(codes({ ...late, closed: true }), []);
});

test("an operator below the fee floor is named", () => {
  const issues = assessWatch({ ...healthy, balances: [{ role: "reviewer", address: "R", lamports: LOW_FEE_LAMPORTS - 1n }] });
  assert.deepEqual(issues, [{ code: "low_fee_balance", role: "reviewer", address: "R", sol: 0.049999999 }]);
});
