import type { Ledger, MissingPayoutEvidence, Observation } from "./types.ts";
import type { Snapshot } from "./snapshot.ts";

export const DAILY_RESET_REASON = "New UTC day or count: uncollected eligibility cleared, no tokens moved";

export function atPayoutBoundary<T extends Ledger>(state: T, snapshot: Snapshot): T {
  return snapshot.payoutBoundary ? {...state, payoutBoundary: snapshot.payoutBoundary} : state;
}

function sameScope(previous: Ledger | null, snapshot: Snapshot) {
  return !!previous?.payoutBoundary && !!snapshot.payoutBoundary
    && previous.payoutBoundary.scope === snapshot.payoutBoundary.scope
    && snapshot.payoutBoundary.at >= previous.payoutBoundary.at;
}

export function resetReason(previous: Ledger | null, snapshot: Snapshot, fallback: string) {
  return previous && previous.binding !== snapshot.binding && snapshot.active && sameScope(previous, snapshot)
    ? DAILY_RESET_REASON : fallback;
}

/** Keep the old cursor only for an already recorded attribution wait. Clearing
 * eligibility here cannot authorize anything: the entire batch must replay. */
export function carryPayoutWait(previous: Ledger, snapshot: Snapshot): Ledger | null {
  if (!snapshot.active || previous.binding === snapshot.binding || previous.pending || previous.payoutCarryBlocked
      || !sameScope(previous, snapshot) || previous.payoutWaitUntil === undefined
      || !previous.payoutWaitSignatures?.length) return null;
  // Old workers must reject this journal instead of replaying the retained
  // cursor without the selective carry filter and restoring discarded rewards.
  return atPayoutBoundary({...previous, version: 2, binding: snapshot.binding, eligible: "0",
    payoutCarryAfter: Math.max(previous.payoutCarryAfter ?? 0, snapshot.payoutBoundary!.at)}, snapshot);
}

export function rememberPayoutWait(previous: Ledger, snapshot: Snapshot, error: MissingPayoutEvidence): Ledger {
  const signatures = new Set(previous.payoutWaitSignatures);
  for (const observation of error.observations) {
    // A newly encountered old receipt cannot join the exception retroactively.
    if (previous.payoutCarryAfter === undefined || (observation.receivedAt !== null
        && observation.receivedAt !== undefined && observation.receivedAt > previous.payoutCarryAfter))
      signatures.add(observation.signature);
  }
  return {...previous,
    // Old journals acquire context only within the same existing binding. Do not
    // claim continuity retroactively across an unseen incident or count change.
    ...(!previous.payoutBoundary && previous.binding === snapshot.binding && snapshot.payoutBoundary
      ? {payoutBoundary: snapshot.payoutBoundary} : {}),
    payoutWaitSignatures: [...signatures],
    ...(!snapshot.active || (previous.payoutBoundary && snapshot.payoutBoundary
      && previous.payoutBoundary.scope !== snapshot.payoutBoundary.scope) ? {payoutCarryBlocked: true as const} : {}),
    payoutWaitUntil: Math.min(previous.payoutWaitUntil ?? Infinity, error.retryUntil),
    payoutWaitStartedAt: previous.payoutWaitStartedAt ?? snapshot.now};
}

export function payoutReplay(previous: Ledger, observations: Observation[]): Observation[] {
  if (previous.payoutCarryAfter === undefined) return observations;
  const waiting = new Set(previous.payoutWaitSignatures);
  return observations.map(o => o.kind === "reward" && !waiting.has(o.signature)
    // Block time has second precision. A receipt in the count's exact second
    // cannot prove it followed that count unless it was already waiting.
    && !(o.receivedAt !== null && o.receivedAt !== undefined && o.receivedAt > previous.payoutCarryAfter!)
    ? {...o, kind: "other", amount: "0", reason: "Verified before the new day/count; uncollected eligibility cleared"}
    : o);
}
