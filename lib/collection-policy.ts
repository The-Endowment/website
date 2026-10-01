/** Deliberate release gate; change only in a reviewed, authorized rollout. */
export const COLLECTION_RELEASED: boolean = false;

/** Remove this hold only with a reviewed replacement for balance-based sweeps. */
export const COLLECTION_PENDING_NOTICE =
  "Enrollment and automated contributions are closed while the refundable collection system is being tested and reviewed.";

/** Deliberately has no environment switch, signer or transaction dependency. */
export function unavailableSweep() {
  return { skipped: COLLECTION_PENDING_NOTICE, fundingState: "routing_pending", sweepsOn: false } as const;
}
