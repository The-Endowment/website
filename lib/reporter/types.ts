/** Amounts are base-unit decimal strings in durable records; never JS floats. */
export type Distribution = { signature: string; mint: string; quoteMint: string; amountRaw: string };
export type TokenBalance = {
  accountIndex: number; mint: string; owner?: string; programId?: string;
  uiTokenAmount: { amount: string; decimals: number };
};
export type ParsedInstruction = {
  programId: string; accounts?: string[]; data?: string;
  parsed?: { type: string; info: Record<string, unknown> };
};
export type ParsedTransaction = {
  slot: number; blockTime: number | null;
  transaction: { signatures: string[]; message: { accountKeys: { pubkey: string; signer: boolean; writable?: boolean }[]; instructions: ParsedInstruction[] } };
  meta: null | {
    err: unknown; preTokenBalances: TokenBalance[]; postTokenBalances: TokenBalance[];
    innerInstructions: { index: number; instructions: ParsedInstruction[] }[] | null;
  };
};
export type SourcePolicy = { mint: string; tokenProgram: string; authority: string; source: string; rewardMint?: string };
export type Observation = {
  signature: string; slot: number; receivedAt?: number | null; before: string; after: string;
  kind: "reward" | "outflow" | "other" | "failed" | "uncertain";
  amount: string; reason: string;
  /** Uncertain, but fully parsed and reconciled (a swap routed through the holder's
   * account): it resets only this wallet and is not evidence of a shared failure. */
  contained?: true;
  payoutAttribution?: "expired" | "covered_absent";
  payoutEvidence?: {
    version: string; mint: string; wallet: string; signature: string; assetMint: string;
    apiGross: string; targetAccount: string; ownerGross: string; creditedNet: string; createdAt: string;
  };
};
export type Prepared = {
  wire: string; signature: string; nonce: string; amount: string;
  lastValidBlockHeight: string; expiresAt: number; evidenceHash: string;
};
export type Ledger = {
  version: 1; binding: string; slot: number; cursor: string | null;
  balance: string; eligible: string; pending: Prepared | null;
  // A known submission was cleared durably, but its source history still needs
  // replay. Recovery must not read a bank older than the settled submission.
  settled?: { slot: number; nonce: string };
  // First unresolved receipt bounds the entire uncommitted history batch.
  payoutWaitUntil?: number;
  // Operational alert age starts when this worker actually begins waiting.
  payoutWaitStartedAt?: number;
};
export function raw(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) throw new Error("Invalid base-unit amount");
  const amount = BigInt(value);
  if (amount > (1n << 64n) - 1n) throw new Error("Amount exceeds u64");
  return amount;
}

/** Preserve the whole wallet history while a proven distributor receipt waits
 * for API attribution. Its deadline is fixed by finalized chain time. */
export const PAYOUT_EVIDENCE_WAIT_SECONDS = 6 * 60 * 60;
export class MissingPayoutEvidence extends Error {
  readonly observation: Observation;
  readonly retryUntil: number;
  constructor(observation: Observation, retryUntil: number) {
    super("Waiting for holder payout evidence");
    this.name = "MissingPayoutEvidence";
    this.observation = observation;
    this.retryUntil = retryUntil;
  }
}
