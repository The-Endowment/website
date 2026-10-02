import { raw, type Ledger, type Observation } from "./types.ts";

export function boundary(binding: string, slot: number, cursor: string | null, balance: string): Ledger {
  raw(balance);
  if (!Number.isSafeInteger(slot) || slot < 0) throw new Error("Invalid finalized slot");
  return { version: 1, binding, slot, cursor, balance, eligible: "0", pending: null };
}

/** All uncertain funds are left with the holder. A purchase can never revive
 * eligibility consumed by spending or discarded at an observation boundary. */
export function observe(previous: Ledger, observations: Observation[], slot: number, balance: string, cursor: string | null): { ledger: Ledger; reason: string } {
  if (previous.pending) throw new Error("Reconcile the prepared transaction before observing more history");
  if (slot < previous.slot) throw new Error("Finalized slot moved backwards");
  let available = raw(previous.eligible), running = raw(previous.balance);
  const ids = new Set<string>(); const slots = new Set<number>();
  for (const receipt of observations) {
    if (ids.has(receipt.signature) || receipt.slot <= previous.slot || receipt.slot > slot || slots.has(receipt.slot)
        || receipt.kind === "uncertain" || raw(receipt.before) !== running) {
      return { ledger: boundary(previous.binding, slot, cursor, balance), reason: "Uncertain, duplicate, same-slot, or discontinuous history: reset eligibility" };
    }
    ids.add(receipt.signature); slots.add(receipt.slot);
    if (receipt.kind === "reward") available += raw(receipt.amount);
    if (receipt.kind === "outflow") available = available > raw(receipt.amount) ? available - raw(receipt.amount) : 0n;
    running = raw(receipt.after);
    if (available > running) return { ledger: boundary(previous.binding, slot, cursor, balance), reason: "Eligibility exceeds reconciled balance: reset" };
  }
  if (running !== raw(balance)) return { ledger: boundary(previous.binding, slot, cursor, balance), reason: "Account changed without complete history: reset eligibility" };
  const ledger = { ...previous, slot, cursor, balance, eligible: available.toString() };
  // The replay now includes the settled submission, so the ordinary ledger
  // slot provides the durable lower bound for future snapshots.
  delete ledger.settled;
  return { ledger, reason: "Finalized history reconciled" };
}
