import assert from "node:assert/strict";
import { test } from "node:test";
import { collectionStatus } from "../lib/collection-status.ts";

const now = 1_800_000_000;
const base = {
  active: true, pausedUntil: 0n, retired: false, milestoneReached: false,
  lastCountAt: BigInt(now - 3600), reserved: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  params: { activateBps: 3000 },
} as unknown as Parameters<typeof collectionStatus>[0];

test("active public collection with a fresh count is on", () => {
  assert.equal(collectionStatus(base, now), "on");
});

test("a founders' test is never shown as on, even though its threshold flag is set", () => {
  assert.equal(collectionStatus({ ...base, reserved: Array(11).fill(0), params: { ...base.params, activateBps: 0 } }, now), "founders");
});

test("a pause, including an incident pause, overrides the threshold flag", () => {
  assert.equal(collectionStatus({ ...base, pausedUntil: (1n << 63n) - 1n }, now), "paused");
});

test("a stale count, below threshold, and closed are reported as such", () => {
  assert.equal(collectionStatus({ ...base, lastCountAt: BigInt(now - 4 * 86_400) }, now), "count-due");
  assert.equal(collectionStatus({ ...base, active: false }, now), "building");
  assert.equal(collectionStatus({ ...base, milestoneReached: true }, now), "closed");
});
