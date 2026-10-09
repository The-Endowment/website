import assert from "node:assert/strict";
import { test } from "node:test";
import { holdingBank } from "./support/holding-bank.mts";
import { holdSnapshot } from "../lib/holding/snapshot.ts";
import { settlementPlan } from "../lib/holding/reconcile.ts";

test("founders and public snapshots require a nonzero, nonfuture count at most 72h old", async t => {
  const bank = await holdingBank();
  t.mock.method(Date, "now", () => bank.time() * 1000);
  for (const threshold of [0, 3000]) {
    bank.config.params.activate_bps = threshold;
    for (const [at, eligible] of [[0n, false], [BigInt(bank.time() + 1), false],
      [BigInt(bank.time() - 259200), true], [BigInt(bank.time() - 259201), false]] as const) {
      bank.config.last_count_at = at;
      assert.equal((await holdSnapshot(bank.rpc, bank.inst, bank.owner)).active, eligible);
    }
  }
});

test("incident cutoff overrides prior approval forever; later contributions can clear", async t => {
  const bank = await holdingBank();
  t.mock.method(Date, "now", () => bank.time() * 1000);
  bank.move("reward", 40n); bank.move("sweep", 40n);
  const evidence = "1".repeat(64);
  bank.receipt.reviewed = true;
  bank.receipt.approved_amount = 40n;
  bank.receipt.review_evidence = Array(32).fill(17);
  bank.advance(86400);
  const decision = { amount: "40", evidenceHash: evidence, sweepSignature: "sweep",
    collectedAt: bank.receipt.collected_at.toString() };
  for (const cutoff of [bank.receipt.collected_at, bank.receipt.collected_at + 1n]) {
    bank.config.pause_started_at = cutoff;
    bank.config.paused_until = 0n; // The incident has already been investigated and resumed.
    const snapshot = await holdSnapshot(bank.rpc, bank.inst, bank.owner, 0, "reviewer");
    assert.equal(settlementPlan(bank.receipt, snapshot, decision), "refund");
    assert.equal(settlementPlan(bank.receipt, snapshot), "refund");
  }
  bank.config.pause_started_at = bank.receipt.collected_at - 1n;
  bank.config.last_count_at = 0n; // Count inactivity must not stop recovery/settlement.
  const snapshot = await holdSnapshot(bank.rpc, bank.inst, bank.owner, 0, "reviewer");
  assert.equal(snapshot.active, false);
  assert.equal(settlementPlan(bank.receipt, snapshot, decision), "clear");
});
