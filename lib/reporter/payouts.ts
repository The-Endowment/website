import { raw } from "./types.ts";

export const VERIFICATION_VERSION = "stonk-holder-v1";
export const PAYOUT_FEED_MAX_AGE_MS = 120_000;
export const PAYOUT_ARCHIVE_GRACE_SECONDS = 10 * 60;
export type WalletPayout = {
  signature: string; holder: string; assetMint: string; amountRaw: string; createdAt: string;
};
export type WalletPayoutFeed = {
  version: typeof VERIFICATION_VERSION;
  mint: string; quoteMint: string;
  records: Map<string, WalletPayout>;
  // Set only by the validated, fresh, gap-free completed-archive reader.
  // fetchedAt is the FIRST page's capture time, not an indexing watermark.
  completedArchive?: { fetchedAt: string };
};
export const walletPayoutKey = (signature: string, holder: string, assetMint: string) => `${signature}:${holder}:${assetMint}`;
const identity = (value: unknown) => typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(value);

/** An operational no-credit cutoff, never proof of another generating coin.
 * Recheck freshness at use: a long wallet pass can outlive the archive read. */
export function archiveGraceElapsed(feed: WalletPayoutFeed, blockTime: number, now: number): boolean {
  const value = feed.completedArchive?.fetchedAt;
  if (typeof value !== "string" || !Number.isSafeInteger(blockTime) || blockTime < 0
      || !Number.isSafeInteger(now) || blockTime > now) return false;
  const fetchedAt = Date.parse(value), age = now * 1000 - fetchedAt;
  return Number.isFinite(fetchedAt) && age >= 0 && age <= PAYOUT_FEED_MAX_AGE_MS
    && fetchedAt >= (blockTime + PAYOUT_ARCHIVE_GRACE_SECONDS) * 1000;
}

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
  return { version: VERIFICATION_VERSION, mint: scope.mint, quoteMint: scope.quoteMint, records };
}
