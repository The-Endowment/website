import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTIVE_MAX_AGE_SECS, fundingState } from "../lib/funding-state.ts";

const now = 1_800_000_000;
const target = 200_000_000_000_000n;
const active = {
  milestoneReached: false,
  retired: false,
  pausedUntil: 0n,
  contributionCap: target,
  active: true,
  lastCountAt: BigInt(now),
  params: { activateBps: 3_000 },
};

test("the final base unit of direct holdings ends collection, including donations", () => {
  assert.equal(fundingState(active, target - 1n, now), "enabled");
  assert.equal(fundingState(active, target, now), "complete");
  assert.equal(fundingState(active, target + 1n, now), "complete");
});

test("purchase and LP totals do not substitute for direct holdings", () => {
  const historical = { ...active, totalCoinBought: target * 2n, totalLpTokens: target * 2n };
  assert.equal(fundingState(historical, target - 1n, now), "enabled");
});

test("recorded completion stays final even if holdings are lower or unavailable", () => {
  const completed = { ...active, milestoneReached: true };
  assert.equal(fundingState(completed, 0n, now), "complete");
  assert.equal(fundingState(completed, null, now), "complete");
});

test("completion takes precedence over temporary pause, retirement and inactivity", () => {
  const stopped = { ...active, pausedUntil: BigInt(now + 1), retired: true, active: false };
  assert.equal(fundingState(stopped, target, now), "complete");
});

test("missing balance never enables collection", () => {
  assert.equal(fundingState(active, null, now), "unavailable");
});

test("retirement, pause and count inactivity each stop collection", () => {
  assert.equal(fundingState({ ...active, retired: true }, 0n, now), "retired");
  assert.equal(fundingState({ ...active, pausedUntil: BigInt(now + 1) }, 0n, now), "paused");
  assert.equal(fundingState({ ...active, pausedUntil: BigInt(now) }, 0n, now), "enabled");
  assert.equal(fundingState({ ...active, active: false }, 0n, now), "waiting");
});

test("a count expires strictly after three days, matching the program", () => {
  assert.equal(fundingState(active, 0n, now + ACTIVE_MAX_AGE_SECS), "enabled");
  assert.equal(fundingState(active, 0n, now + ACTIVE_MAX_AGE_SECS + 1), "stale");
  const testConfig = { ...active, params: { activateBps: 0 } };
  assert.equal(fundingState(testConfig, 0n, now + ACTIVE_MAX_AGE_SECS + 1), "enabled");
  assert.equal(fundingState(testConfig, target, now + ACTIVE_MAX_AGE_SECS + 1), "complete");
});

test("vault comparisons preserve token precision above JavaScript's safe integer range", () => {
  const largeTarget = 9_007_199_254_740_993n;
  const config = { ...active, contributionCap: largeTarget };
  assert.equal(fundingState(config, largeTarget - 1n, now), "enabled");
  assert.equal(fundingState(config, largeTarget, now), "complete");
});
