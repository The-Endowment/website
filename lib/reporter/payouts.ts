import { raw } from "./types.ts";

export const VERIFICATION_VERSION = "stonk-holder-v1";
export type WalletPayout = {
  signature: string; holder: string; assetMint: string; amountRaw: string; createdAt: string;
};
export type WalletPayoutFeed = {
  version: typeof VERIFICATION_VERSION;
  mint: string; quoteMint: string;
  records: Map<string, WalletPayout>;
};
export const walletPayoutKey = (signature: string, holder: string, assetMint: string) => `${signature}:${holder}:${assetMint}`;
const identity = (value: unknown) => typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(value);

/** Scope comes from the validated per-token archive source, never from a
 * caller-supplied holder row. Aggregate v1 records cannot enter this index. */
export function walletPayouts(rows: WalletPayout[], scope: { mint: string; quoteMint: string }): WalletPayoutFeed {
  if (!identity(scope.mint) || !identity(scope.quoteMint)) throw new Error("Invalid wallet payout scope");
  const records = new Map<string, WalletPayout>();
  for (const row of rows) {
    if (!row || ![row.signature, row.holder, row.assetMint].every(identity)
        || typeof row.createdAt !== "string" || !Number.isFinite(Date.parse(row.createdAt)))
      throw new Error("Invalid wallet payout");
    raw(row.amountRaw);
    if (row.assetMint !== scope.quoteMint) continue;
    const key = walletPayoutKey(row.signature, row.holder, row.assetMint), old = records.get(key);
    if (old && (old.amountRaw !== row.amountRaw || old.createdAt !== row.createdAt))
      throw new Error("Conflicting wallet payout");
    records.set(key, { signature: row.signature, holder: row.holder, assetMint: row.assetMint,
      amountRaw: row.amountRaw, createdAt: row.createdAt });
  }
  return { version: VERIFICATION_VERSION, ...scope, records };
}
