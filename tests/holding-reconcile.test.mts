import assert from "node:assert/strict";
import { test } from "node:test";
import { getBase58Decoder } from "@solana/kit";
import { boundary } from "../lib/reporter/ledger.ts";
import type { Journal } from "../lib/reporter/journal.ts";
import type { Observation, ParsedTransaction } from "../lib/reporter/types.ts";
import {
  reconcileHistory,
  resetReviewer,
  settlementPlan,
  type ReviewedLedger,
} from "../lib/holding/reconcile.ts";
import type { HoldSnapshot } from "../lib/holding/snapshot.ts";
import type { Receipt } from "../lib/holding/types.ts";
import { schema } from "../lib/holding/codec.ts";
const receipt = {
  config: "config",
  owner: "holder",
  payer: "collector",
  nonce: 0n,
  consent_epoch: 2n,
  amount: 40n,
  collected_at: 100n,
  release_at: 86500n,
  refund_at: 259300n,
  reviewed: false,
  approved_amount: 0n,
  collection_evidence: [],
  review_evidence: [],
  bump: 1,
} as unknown as Receipt;
function snapshot(now = 86500): HoldSnapshot {
  return {
    policy: { reviewer: "reviewer" },
    binding: "same",
    slot: 5,
    balance: "95",
    consentId: "2",
    now,
    goalReached: false,
    landlord: {},
    consent: { enabled: true, epoch: 2n },
    config: { retired: false, milestone_reached: false, paused_until: 0n, pause_started_at: 0n },
  } as HoldSnapshot;
}
function journal(): Journal {
  return {
    state: { ...boundary("same", 1, "start", "20"), reviewer: "reviewer" } as ReviewedLedger,
    hash: "0".repeat(64),
    async save(state) {
      this.state = state;
      this.hash = "1".repeat(64);
    },
  };
}
function observation(
  slot: number,
  before: string,
  after: string,
  kind: Observation["kind"],
  amount: string,
): Observation {
  return {
    slot,
    before,
    after,
    kind,
    amount,
    signature: `tx${slot}`,
    reason: "test",
    receivedAt: 100,
  };
}
const receiptKey = "receipt";
function collectionTx(o: Observation, mention = true): ParsedTransaction {
  const accounts = schema.instructions.sweep.accounts.map((a) =>
    a.name === "receipt" ? receiptKey : a.name,
  );
  return {
    slot: o.slot,
    blockTime: 100,
    transaction: {
      signatures: [o.signature],
      message: {
        accountKeys: [],
        instructions: mention
          ? [
              {
                programId: "program",
                accounts,
                data: getBase58Decoder().decode(
                  Uint8Array.from(schema.instructions.sweep.discriminator),
                ),
              },
            ]
          : [],
      },
    },
    meta: {
      err: null,
      preTokenBalances: [],
      postTokenBalances: [],
      innerInstructions: [],
    },
  };
}
test("reviewer limits clearance to rewards left after spending, excludes purchases", async () => {
  const j = journal();
  const observations = [
    observation(2, "20", "120", "other", "100"),
    observation(3, "120", "160", "reward", "40"),
    observation(4, "160", "135", "outflow", "25"),
    observation(5, "135", "95", "outflow", "40"),
  ];
  const transactions = observations.map((o, i) => collectionTx(o, i === 3));
  await reconcileHistory(
    j,
    snapshot(),
    { transactions, cursor: "tx5" },
    observations,
    [{ address: receiptKey, receipt }],
    "program",
  );
  const decision = (j.state as ReviewedLedger).reviews![receiptKey];
  assert.equal(decision.amount, "15");
  assert.equal(decision.sweepSignature, "tx5");
  assert.equal(decision.collectedAt, "100");
  assert.equal(j.state!.eligible, "0");
  assert.equal(settlementPlan(receipt, snapshot(), decision), "clear");
});
test("same-slot ambiguity cannot produce positive clearance", async () => {
  const j = journal(),
    s = snapshot();
  s.balance = "20";
  s.slot = 2;
  const rows = [
    observation(2, "20", "60", "reward", "40"),
    { ...observation(2, "60", "20", "outflow", "40"), signature: "second" },
  ];
  await reconcileHistory(
    j,
    s,
    {
      transactions: rows.map((o, i) => collectionTx(o, i === 1)),
      cursor: "second",
    },
    rows,
    [{ address: receiptKey, receipt }],
    "program",
  );
  assert.equal((j.state as ReviewedLedger).reviews![receiptKey].amount, "0");
});
test("a receipt mentioned by another instruction does not count as collection evidence", async () => {
  const j = journal();
  j.state!.eligible = "20";
  const o = observation(2, "20", "0", "outflow", "20"),
    tx = collectionTx(o);
  tx.transaction.message.instructions[0].data = getBase58Decoder().decode(
    Uint8Array.from(schema.instructions.review_collection.discriminator),
  );
  const s = snapshot();
  s.balance = "0";
  s.slot = 2;
  await reconcileHistory(
    j,
    s,
    { transactions: [tx], cursor: o.signature },
    [o],
    [{ address: receiptKey, receipt: { ...receipt, amount: 20n } }],
    "program",
  );
  assert.equal((j.state as ReviewedLedger).reviews![receiptKey], undefined);
});
test("hold, expiry, revocation, goal, pause and missing evidence fail closed", () => {
  const decision = {
    amount: "15",
    evidenceHash: "1".repeat(64),
    sweepSignature: "tx",
    collectedAt: "100",
  };
  assert.equal(settlementPlan(receipt, snapshot(86499), decision), "wait");
  assert.equal(settlementPlan(receipt, snapshot(), undefined), "refund");
  assert.equal(settlementPlan(receipt, snapshot(259300), decision), "refund");
  const s = snapshot();
  s.consent!.epoch = 3n;
  assert.equal(settlementPlan(receipt, s, decision), "refund");
  s.consent!.epoch = 2n;
  s.goalReached = true;
  assert.equal(settlementPlan(receipt, s, decision), "refund");
  s.goalReached = false;
  s.config.paused_until = 90000n;
  assert.equal(settlementPlan(receipt, s, decision), "wait");
  s.config.paused_until = 0n;
  assert.throws(() =>
    settlementPlan(receipt, s, { ...decision, amount: "41" }),
  );
});
test("missing landlord refunds immediately; temporary inactivity alone does not", () => {
  const decision = {
    amount: "40", evidenceHash: "1".repeat(64), sweepSignature: "tx", collectedAt: "100",
  };
  for (const now of [86499, 86500]) {
    const s = snapshot(now);
    s.landlord = null;
    s.active = false;
    assert.equal(settlementPlan(receipt, s, decision), "refund");
    s.config.pause_started_at = 80000n;
    s.config.paused_until = 90000n;
    assert.equal(settlementPlan(receipt, s, decision), "refund");
  }
  const paused = snapshot();
  paused.active = false;
  paused.config.pause_started_at = 80000n;
  paused.config.paused_until = 90000n;
  assert.equal(settlementPlan(receipt, paused, decision), "wait");
  paused.config.paused_until = 0n;
  assert.equal(settlementPlan(receipt, paused, decision), "clear");
});

test("day boundaries discard uncollected eligibility but retain decisions for already held funds", async () => {
  const j = journal();
  (j.state as ReviewedLedger).reviews = {
    [receiptKey]: {
      amount: "15",
      evidenceHash: "1".repeat(64),
      sweepSignature: "tx",
      collectedAt: "100",
    },
  };
  j.state!.eligible = "20";
  const s = snapshot();
  s.binding = "next-day";
  await resetReviewer(j, s, "next");
  assert.equal(j.state!.eligible, "0");
  assert.equal((j.state as ReviewedLedger).reviews![receiptKey].amount, "15");
});

test("reviewer rotation discards the previous reviewer's decisions", async () => {
  const j = journal();
  (j.state as ReviewedLedger).reviews = { [receiptKey]: {
    amount: "40", evidenceHash: "1".repeat(64), sweepSignature: "old", collectedAt: "100",
  } };
  const s = snapshot();
  s.policy.reviewer = "replacement" as typeof s.policy.reviewer;
  await resetReviewer(j, s, "new-boundary");
  assert.deepEqual((j.state as ReviewedLedger).reviews, {});
  assert.equal(settlementPlan(receipt, s), "refund");
});
