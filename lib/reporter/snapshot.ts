/** Shared observation state; chain reads live in holding/snapshot.ts. */
export type Snapshot = {
  binding: string; slot: number; now: number; active: boolean; reason: string;
  balance: string; nonce: string; allowance: string; capacity: string;
  consentId: string; collectionEpoch: string; reporterEpoch: string; reporter: string;
};
