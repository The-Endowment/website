import { distributions } from "../reporter/classify.ts";
import { raw, type Distribution } from "../reporter/types.ts";
import { FEED_SCOPE, type FeedArchive } from "./feed-state.ts";

export const PAYOUT_URL = `https://www.stonkfun.xyz/api/v2/tokens/${FEED_SCOPE.mint}/rewards/payouts`;
export type Payout = { signature: string; holder: string; assetMint: string; amountRaw: string; createdAt: string };
export type Gap = FeedArchive["coverage"]["gap"];
export type HistoryArchive = {
  version: 2; source: string; fetchedAt: string; baselineAt: string;
  historyFloor?: string;
  coverage: { completeCoverageProven: false; gap: Gap };
  headKeys: string[]; rows: Payout[]; legacyDistributions: Distribution[];
  data: { recentDistributions: Distribution[] };
};

export function timestamp(value: unknown): number {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("Invalid payout timestamp");
  return Date.parse(value);
}

export function payout(value: unknown): Payout {
  const r = value as Payout;
  if (!r || ![r.signature, r.holder, r.assetMint].every((x) => typeof x === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(x)))
    throw new Error("Invalid payout identity");
  raw(r.amountRaw); timestamp(r.createdAt);
  return { signature: r.signature, holder: r.holder, assetMint: r.assetMint, amountRaw: r.amountRaw, createdAt: r.createdAt };
}

// The documented row is one holder's payout, not a transaction total. Keep the
// holder and asset in the identity so shared signatures are never deduplicated away.
export const payoutKey = (r: Payout): string => `${r.signature}:${r.holder}:${r.assetMint}`;
export function mergeRows(...groups: Payout[][]): Payout[] {
  const rows = new Map<string, Payout>();
  for (const group of groups) for (const input of group) {
    const r = payout(input), key = payoutKey(r), old = rows.get(key);
    if (old && (old.amountRaw !== r.amountRaw || old.createdAt !== r.createdAt))
      throw new Error("Payout record changed");
    rows.set(key, r);
  }
  return [...rows.values()];
}

/** Derived sums of retained rows, which may grow as distinct holders are found.
 * Totals are migration/archive integrity evidence only, never wallet eligibility. */
export function distributionTotals(rows: Payout[], legacy: Distribution[]): Distribution[] {
  const sums = new Map<string, bigint>();
  for (const r of mergeRows(rows)) {
    if (r.assetMint !== FEED_SCOPE.quoteMint) continue;
    const sum = (sums.get(r.signature) ?? 0n) + raw(r.amountRaw);
    raw(sum.toString()); // Reject u64 overflow before publishing any evidence.
    sums.set(r.signature, sum);
  }
  const records = distributions({ data: { recentDistributions: legacy } }, FEED_SCOPE);
  for (const [signature, amount] of sums) {
    const r = { signature, ...FEED_SCOPE, amountRaw: amount.toString() };
    if (records.has(signature) && records.get(signature)!.amountRaw !== r.amountRaw)
      throw new Error("Legacy payout total changed");
    records.set(signature, r);
  }
  return [...records.values()];
}

export function validateGap(gap: unknown, baseline: string): asserts gap is Gap {
  if (gap === null) return;
  const g = gap as NonNullable<Gap>;
  if (!g || !["capture_stalled", "window_disjoint", "feed_invalid"].includes(g.reason)
      || timestamp(g.detectedAt) < timestamp(baseline)) throw new Error("Invalid payout gap");
}

export function historyArchive(value: unknown): HistoryArchive {
  const a = value as HistoryArchive;
  if (!a || a.version !== 2 || a.source !== PAYOUT_URL || a.coverage?.completeCoverageProven !== false
      || !Array.isArray(a.rows) || !Array.isArray(a.legacyDistributions) || !Array.isArray(a.headKeys)
      || a.headKeys.length > 100 || new Set(a.headKeys).size !== a.headKeys.length
      || timestamp(a.baselineAt) > timestamp(a.fetchedAt)) throw new Error("Invalid payout history archive");
  validateGap(a.coverage.gap, a.baselineAt);
  if (a.historyFloor !== undefined && timestamp(a.historyFloor) > timestamp(a.baselineAt))
    throw new Error("Invalid payout history floor");
  const rows = mergeRows(a.rows), keys = new Set(rows.map(payoutKey));
  if (rows.length !== a.rows.length || a.headKeys.some((k) => !keys.has(k))) throw new Error("Invalid payout head");
  const expected = distributionTotals(rows, a.legacyDistributions);
  const actual = distributions(a, FEED_SCOPE);
  if (actual.size !== expected.length || expected.some((r) => JSON.stringify(actual.get(r.signature)) !== JSON.stringify(r)))
    throw new Error("Payout totals do not match archived rows");
  return a;
}

export function payoutPage(value: unknown): { rows: Payout[]; nextCursor: string | null } {
  const body = value as { rows?: unknown; page?: { limit?: unknown; order?: unknown; nextCursor?: unknown } };
  const cursor = body?.page?.nextCursor;
  if (!body || !Array.isArray(body.rows) || body.rows.length > 100 || !body.page
      || (cursor !== null && (typeof cursor !== "string" || !cursor.length || cursor.length > 4096))
      || body.page.order !== "desc" || body.page.limit !== 100) throw new Error("Invalid payout page");
  return { rows: body.rows.map(payout), nextCursor: cursor as string | null };
}
