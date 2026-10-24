import { createHash } from "node:crypto";
import { boundary, observe } from "./ledger.ts";
import { MissingPayoutEvidence, raw, type Ledger, type Observation, type Prepared } from "./types.ts";
import type { Journal } from "./journal.ts";
import type { Snapshot } from "./snapshot.ts";
import { atPayoutBoundary, carryPayoutWait, DAILY_RESET_REASON, payoutReplay, rememberPayoutWait, resetReason } from "./payout-wait.ts";

export type ReporterIO = {
  snapshot: (minSlot: number) => Promise<Snapshot>;
  cursor: (snapshot: Snapshot) => Promise<string | null>;
  observations: (ledger: Ledger, snapshot: Snapshot) => Promise<{ observations: Observation[]; cursor: string | null }>;
  prepare: (snapshot: Snapshot, amount: bigint, evidenceHash: string) => Promise<Prepared>;
  status: (signature: string) => Promise<"finalized" | "failed" | "pending">;
  height: () => Promise<bigint>;
  publish: (wire: string) => Promise<void>;
};

/** Single wallet tick. Prepared bytes are durable BEFORE broadcast; no fresh
 * nonce is signed while any earlier submission's outcome remains uncertain. */
export async function runWallet(journal: Journal, io: ReporterIO, submit = false) {
  let ledger = journal.state;
  let snapshot = await io.snapshot(Math.max(ledger?.slot ?? 0, ledger?.settled?.slot ?? 0));
  const reset = async (reason: string) => {
    const next = atPayoutBoundary(boundary(snapshot.binding, snapshot.slot, await io.cursor(snapshot), snapshot.balance), snapshot);
    await journal.save(next, reason);
    return { status: "boundary", reason };
  };
  if (ledger?.pending) {
    const pending = ledger.pending;
    const status = await io.status(pending.signature);
    if (status === "pending" && await io.height() <= raw(pending.lastValidBlockHeight)) {
      // Do not issue a different authorization or blindly resend during recovery.
      return { status: "pending", signature: pending.signature };
    }
    if (status === "pending") return reset("Prepared transaction expired with unknown outcome; remaining eligibility discarded");
    // The status query may have finalized after our first snapshot. Require a
    // bank that includes the consumed nonce before forgetting a successful send.
    snapshot = await io.snapshot(snapshot.slot);
    if (ledger.binding !== snapshot.binding || !snapshot.active) return reset(resetReason(ledger, snapshot, snapshot.reason));
    const minimumNonce = raw(pending.nonce) - (status === "failed" ? 1n : 0n);
    if (raw(snapshot.nonce) < minimumNonce) return { status: "pending", signature: pending.signature };
    ledger = { ...ledger, pending: null, settled: { slot: snapshot.slot, nonce: snapshot.nonce } };
    await journal.save(ledger, `Prepared transaction reconciled: ${status}; replay source history`, { signature: pending.signature, status });
  }
  if (ledger && ledger.binding !== snapshot.binding) {
    const carried = carryPayoutWait(ledger, snapshot);
    if (carried) {
      await journal.save(carried, DAILY_RESET_REASON + "; pending payout evidence retained");
      ledger = carried;
    }
  }
  if (!ledger || ledger.binding !== snapshot.binding || !snapshot.active)
    return reset(resetReason(ledger, snapshot, snapshot.reason));
  if (ledger.settled && (snapshot.slot < ledger.settled.slot || raw(snapshot.nonce) < raw(ledger.settled.nonce))) {
    return { status: "retry", reason: "Finalized snapshot predates the settled submission" };
  }
  try {
    const batch = await io.observations(ledger, snapshot);
    const observations = payoutReplay(ledger, batch.observations);
    const observed = observe(ledger, observations, snapshot.slot, snapshot.balance, batch.cursor);
    const next = atPayoutBoundary(observed.ledger, snapshot);
    await journal.save(next, observed.reason, observations);
    ledger = next;
  } catch (error) {
    if (error instanceof MissingPayoutEvidence) {
      const waiting = rememberPayoutWait(ledger, snapshot, error);
      const retryUntil = waiting.payoutWaitUntil!, waitStartedAt = waiting.payoutWaitStartedAt!;
      if (JSON.stringify(waiting) !== JSON.stringify(ledger))
        await journal.save(waiting, "Awaiting payout attribution; history cursor retained",
          {signatures: waiting.payoutWaitSignatures, retryUntil, waitStartedAt});
      return { status: "awaiting_payout", reason: error.message, retryUntil, waitStartedAt,
        waitSeconds: Math.max(0, snapshot.now - waitStartedAt) };
    }
    return reset(`Observation gap: ${error instanceof Error ? error.message : "unknown failure"}`);
  }
  let amount = raw(ledger.eligible);
  for (const cap of [snapshot.balance, snapshot.allowance, snapshot.capacity]) if (amount > raw(cap)) amount = raw(cap);
  if (amount === 0n) return { status: "idle", eligible: ledger.eligible };
  // Recheck latest finalized state AND transaction cursor. Equal balance alone
  // cannot detect spending and repurchasing the same amount between reads.
  const latest = await io.snapshot(snapshot.slot);
  if (!latest.active || latest.binding !== ledger.binding || latest.balance !== ledger.balance || latest.nonce !== snapshot.nonce
      || await io.cursor(latest) !== ledger.cursor || raw(latest.capacity) < amount || raw(latest.allowance) < amount) {
    return { status: "retry", reason: "State or history changed before signing" };
  }
  if (!submit) return { status: "dry_run", amount: amount.toString(), eligible: ledger.eligible };
  const evidenceHash = createHash("sha256").update(journal.hash).update(JSON.stringify({ binding: ledger.binding, cursor: ledger.cursor, amount: amount.toString() })).digest("hex");
  const pending = await io.prepare(latest, amount, evidenceHash);
  if (pending.amount !== amount.toString() || raw(pending.nonce) !== raw(latest.nonce) + 1n || pending.evidenceHash !== evidenceHash) {
    throw new Error("Prepared authorization does not match the audited decision");
  }
  await journal.save({ ...ledger, pending }, "Prepared exact transaction before broadcast", { evidenceHash });
  // A timeout is ambiguous. Leave the durable outbox untouched for reconciliation.
  await io.publish(pending.wire);
  return { status: "submitted", signature: pending.signature, amount: pending.amount };
}
