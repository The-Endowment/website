import { createHash } from "node:crypto";
import { getBase58Encoder } from "@solana/kit";
import { boundary, observe } from "../reporter/ledger.ts";
import { raw } from "../reporter/types.ts";
import type {
  Ledger,
  Observation,
  ParsedTransaction,
} from "../reporter/types.ts";
import type { Journal } from "../reporter/journal.ts";
import { schema } from "./codec.ts";
import type { Receipt } from "./types.ts";
import type { HoldSnapshot } from "./snapshot.ts";
import { refundDeadline } from "./bounds.ts";
export type Decision = {
  amount: string;
  evidenceHash: string;
  sweepSignature: string;
  collectedAt: string;
};
export type ReviewedLedger = Ledger & { reviewer?: string; reviews?: Record<string, Decision> };
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Replay every source transaction, consuming reward eligibility before any
 * purchased balance. Same-slot ambiguity or missing history fails closed. */
export async function reconcileHistory(
  journal: Journal,
  snapshot: HoldSnapshot,
  batch: { transactions: ParsedTransaction[]; cursor: string | null },
  observations: Observation[],
  receipts: { address: string; receipt: Receipt }[],
  program: string,
) {
  let state = journal.state as ReviewedLedger | null;
  if (!state)
    throw new Error("Reviewer must establish an observation boundary first");
  const reviews = { ...state.reviews };
  const ambiguous =
    new Set(observations.map((o) => o.slot)).size !== observations.length;
  const receiptIndex = schema.instructions.sweep.accounts.findIndex(
    (a) => a.name === "receipt",
  );
  for (let i = 0; i < observations.length; i++) {
    const tx = batch.transactions[i],
      observation = observations[i];
    if (
      tx.slot !== observation.slot ||
      tx.transaction.signatures[0] !== observation.signature
    )
      throw new Error("Transaction and observation identity mismatch");
    const available = BigInt(state.eligible);
    const single = observe(
      state,
      [observation],
      observation.slot,
      observation.after,
      observation.signature,
    );
    for (const entry of receipts) {
      if (reviews[entry.address]) continue;
      // The program-owned receipt must be named in the successful collection
      // instruction. A mere mention in a transfer or a failed tx is insufficient.
      const linked =
        tx.meta?.err === null &&
        tx.transaction.message.instructions.some(
          (ix) =>
            ix.programId === program &&
            ix.accounts?.[receiptIndex] === entry.address &&
            typeof ix.data === "string" &&
            schema.instructions.sweep.discriminator.every(
              (b, j) => getBase58Encoder().encode(ix.data!)[j] === b,
            ),
        );
      if (!linked) continue;
      const clean =
        !ambiguous &&
        single.reason === "Finalized history reconciled" &&
        observation.kind === "outflow" &&
        BigInt(observation.amount) === entry.receipt.amount &&
        entry.receipt.consent_epoch.toString() === snapshot.consentId;
      const amount = clean
        ? available < entry.receipt.amount
          ? available
          : entry.receipt.amount
        : 0n;
      reviews[entry.address] = {
        amount: amount.toString(),
        sweepSignature: observation.signature,
        collectedAt: entry.receipt.collected_at.toString(),
        evidenceHash: hash({
          previous: journal.hash,
          history: observations.slice(0, i + 1),
          receipt: entry.address,
          amount: amount.toString(),
        }),
      };
    }
    state = { ...single.ledger, reviews };
  }
  const finished = observe(
    state,
    [],
    snapshot.slot,
    snapshot.balance,
    batch.cursor,
  );
  // Never preserve positive clearance across an unexplained balance change.
  if (finished.reason !== "Finalized history reconciled") {
    for (const key of Object.keys(reviews))
      reviews[key] = {
        ...reviews[key],
        amount: "0",
        evidenceHash: hash({
          previous: reviews[key].evidenceHash,
          reason: finished.reason,
        }),
      };
  }
  // Inactivity stops collecting, not recovery. Keep the completed receipt
  // decisions above, but do not carry unused rewards across an incident.
  if (!snapshot.active) finished.ledger.eligible = "0";
  await journal.save(
    { ...finished.ledger, reviews, reviewer: snapshot.policy.reviewer } as ReviewedLedger,
    "Independent wallet reconciliation",
    { observations, reviews },
  );
}

export function settlementPlan(
  receipt: Receipt,
  snapshot: HoldSnapshot,
  decision?: Decision,
): "wait" | "refund" | "clear" {
  const now = BigInt(snapshot.now);
  if (
    // Pruning can remove enrollment without disabling the separate consent.
    // The contract makes that receipt refund-only, even during a hold or pause.
    !snapshot.landlord ||
    !snapshot.consent?.enabled ||
    snapshot.consent.epoch !== receipt.consent_epoch ||
    snapshot.config.retired ||
    (snapshot.config.pause_started_at > 0n && receipt.collected_at <= snapshot.config.pause_started_at) ||
    snapshot.goalReached ||
    now >= refundDeadline(receipt, snapshot.config)
  )
    return "refund";
  // A completed review which approves nothing is a rejection, not a missing
  // review. Returning those funds never needs to wait for the release window
  // or for an incident pause to end. Absence of a decision still waits below.
  const hasEvidence = decision && /^[0-9a-f]{64}$/.test(decision.evidenceHash);
  if (hasEvidence && raw(decision.amount) === 0n) return "refund";
  if (now < receipt.release_at || now < snapshot.config.paused_until)
    return "wait";
  if (!decision || !hasEvidence) return "refund";
  if (raw(decision.amount) > receipt.amount)
    throw new Error("Review exceeds contribution");
  if (
    receipt.reviewed &&
    (receipt.approved_amount > raw(decision.amount) ||
      receipt.review_evidence
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("") !== decision.evidenceHash)
  )
    return "refund";
  return "clear";
}
export async function resetReviewer(
  journal: Journal,
  snapshot: HoldSnapshot,
  cursor: string | null,
) {
  // A restarted/missing history never reuses the collector's claimed amount.
  await journal.save(
    {
      ...boundary(snapshot.binding, snapshot.slot, cursor, snapshot.balance),
      reviewer: snapshot.policy.reviewer,
      reviews: (journal.state as ReviewedLedger | null)?.reviewer === snapshot.policy.reviewer
        ? (journal.state as ReviewedLedger).reviews ?? {} : {},
    } as ReviewedLedger,
    "Reviewer boundary; same-reviewer decisions retained, unswept eligibility discarded",
  );
}
