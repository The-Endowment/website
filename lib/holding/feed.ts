import { createHash } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { distributions } from "../reporter/classify.ts";
import type { Distribution } from "../reporter/types.ts";
import { walletPayouts, type WalletPayoutFeed } from "../reporter/payouts.ts";
import { FEED_MAX_AGE_MS, FEED_SCOPE, archiveState, checkCaptureTime, type FeedClock } from "./feed-state.ts";
import {
  PAYOUT_URL, distributionTotals, historyArchive, mergeRows, payoutKey, payoutPage, timestamp, validateGap,
  type Gap, type HistoryArchive, type Payout,
} from "./payout-history.ts";

export { FEED_MAX_AGE_MS } from "./feed-state.ts";
const ARCHIVE = "payout-feed.json", PENDING = "payout-history-pending.json";
const PAGES_PER_PASS = 5, MAX_PAGES = 100_000;
type Pending = {
  version: 1; source: string; baseHash: string; baselineAt: string; gap: Gap;
  historyFloor?: string;
  headAt: string | null; headKeys: string[]; rows: Payout[];
  cursor: string | null; cursors: string[]; pages: number; oldestAt: string | null;
  complete: boolean; resultHash?: string;
};
const hash = (s: string | null) => createHash("sha256").update(s ?? "missing").digest("hex");
async function optional(path: string): Promise<string | null> {
  try { return await readFile(path, "utf8"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; return null; }
}
async function save(directory: string, name: string, value: unknown): Promise<string> {
  const text = JSON.stringify(value), path = join(directory, name);
  const file = await open(path + ".tmp", "w", 0o600);
  try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
  await rename(path + ".tmp", path);
  const dir = await open(directory, "r");
  try { await dir.sync(); } finally { await dir.close(); }
  return hash(text);
}
function healthy(archive: HistoryArchive, now: number): WalletPayoutFeed {
  checkCaptureTime(archive.fetchedAt, now);
  if (archive.coverage.gap) throw new Error("Possible payout feed gap; manual review required");
  return { ...walletPayouts(archive.rows, FEED_SCOPE), completedArchive: { fetchedAt: archive.fetchedAt } };
}

/** Wallet passes never fetch the provider or consume a partial backfill. */
export async function readArchivedFeed(directory: string, { now = Date.now }: FeedClock = {}): Promise<WalletPayoutFeed> {
  const value = JSON.parse(await readFile(join(directory, ARCHIVE), "utf8"));
  if (value?.version !== 2) throw new Error("Payout history needs a completed v2 baseline");
  return healthy(historyArchive(value), now());
}
export async function assertFeedFresh(directory: string, options: FeedClock = {}): Promise<void> {
  await readArchivedFeed(directory, options);
}

function pendingState(value: unknown, baseHash: string): Pending {
  const p = value as Pending;
  if (!p || p.version !== 1 || p.source !== PAYOUT_URL || p.baseHash !== baseHash
      || typeof p.complete !== "boolean" || !Number.isSafeInteger(p.pages) || p.pages < 0 || p.pages > MAX_PAGES
      || !Array.isArray(p.rows) || !Array.isArray(p.headKeys) || p.headKeys.length > 100
      || !Array.isArray(p.cursors) || p.cursors.length !== p.pages
      || p.cursors.some((c) => typeof c !== "string" || c.length > 4096)
      || new Set(p.cursors).size !== p.cursors.length
      || (p.cursor !== null && (typeof p.cursor !== "string" || !p.cursor.length || p.cursor.length > 4096))
      || (p.resultHash !== undefined && !/^[a-f0-9]{64}$/.test(p.resultHash))) throw new Error("Invalid payout checkpoint");
  timestamp(p.baselineAt); validateGap(p.gap, p.baselineAt);
  if (p.historyFloor !== undefined && timestamp(p.historyFloor) > timestamp(p.baselineAt))
    throw new Error("Invalid payout checkpoint floor");
  if (p.headAt !== null) timestamp(p.headAt);
  if (p.oldestAt !== null) timestamp(p.oldestAt);
  const rows = mergeRows(p.rows), keys = new Set(rows.map(payoutKey));
  const oldest = rows.reduce((time, r) => Math.min(time, timestamp(r.createdAt)), Infinity);
  if ((rows.length === 0) !== (p.oldestAt === null)
      || (p.oldestAt !== null && timestamp(p.oldestAt) !== oldest))
    throw new Error("Invalid payout checkpoint oldest row");
  if (rows.length !== p.rows.length || new Set(p.headKeys).size !== p.headKeys.length
      || p.headKeys.some((k) => !keys.has(k)) || (p.pages === 0) !== (p.headAt === null)
      || (p.pages === 0 && (p.rows.length || p.cursors.length || p.cursor || p.complete)))
    throw new Error("Invalid payout checkpoint rows");
  return p;
}

/** Read a bounded response; one capture pass has a shared 20-second network
 * budget so five slow pages cannot overrun the 50-second systemd timeout. */
async function responseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    await response.body?.cancel();
    throw new Error("Payout response is not JSON");
  }
  if (!response.body) throw new Error("Empty payout response");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000) throw new Error("Payout page too large");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** v2 gives holder rows and opaque cursors. Fetch from the newest page until
 * all prior head rows have been re-observed (or the end on the first scan).
 * Partial scans persist separately, never becoming signing evidence. */
export async function archiveFeed(directory: string, { request = fetch, now = Date.now, historyFloor }: FeedClock & { request?: typeof fetch; historyFloor?: string } = {}): Promise<WalletPayoutFeed> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, "feed.lock");
  await mkdir(lock, { mode: 0o700 });
  try {
    let original = await optional(join(directory, ARCHIVE));
    const cached = original === null ? null : JSON.parse(original);
    let previous = cached?.version === 2 ? historyArchive(cached) : null;
    const legacy = cached !== null && !previous ? archiveState(cached) : null;
    const oldRecords = cached ? distributions(cached, FEED_SCOPE) : new Map<string, Distribution>();
    const baselineAt = previous?.baselineAt ?? legacy?.baselineAt ?? new Date(now()).toISOString();
    const pendingText = await optional(join(directory, PENDING));
    const pendingValue = pendingText === null ? null : JSON.parse(pendingText);
    const storedFloor = previous?.historyFloor ?? pendingValue?.historyFloor;
    const floor = historyFloor === undefined ? storedFloor : new Date(timestamp(historyFloor)).toISOString();
    if (floor !== undefined && timestamp(floor) > timestamp(baselineAt))
      throw new Error("Payout history floor cannot follow the baseline");
    if ((cached !== null || pendingValue !== null) && floor !== storedFloor)
      throw new Error("Payout history floor is immutable; preserve existing history");
    if (previous && pendingValue && previous.historyFloor !== pendingValue.historyFloor)
      throw new Error("Payout checkpoint floor differs from archive");
    if (floor !== undefined && cached === null && pendingValue === null) {
      // This is an explicit new-baseline tool, never a way to truncate existing
      // wallet history, pending outboxes, receipts or a latched incident.
      const entries = await readdir(directory);
      if (entries.some((name) => name !== "role" && name !== "feed.lock"))
        throw new Error("Payout history floor requires a fresh role directory");
    }
    // A crash after atomic publication but before checkpoint removal is harmless.
    if (previous && pendingValue?.resultHash === hash(original)) {
      await unlink(join(directory, PENDING));
      return healthy(previous, now());
    }
    const pending: Pending = pendingValue === null ? {
      version: 1, source: PAYOUT_URL, baseHash: hash(original), baselineAt,
      ...(floor === undefined ? {} : { historyFloor: floor }),
      gap: previous?.coverage.gap ?? legacy?.coverage.gap ?? null,
      headAt: null, headKeys: [], rows: [], cursor: null, cursors: [], pages: 0, oldestAt: null, complete: false,
    } : pendingState(pendingValue, hash(original));
    const target = previous?.headKeys ?? [];
    const reachedFloor = (oldest: string | null) => target.length === 0 && pending.historyFloor !== undefined
      && oldest !== null && timestamp(oldest) < timestamp(pending.historyFloor);
    const checkpointKeys = new Set(pending.rows.map(payoutKey));
    const checkpointComplete = pending.pages > 0 && (pending.cursor === null
      || (target.length > 0 && target.every((k) => checkpointKeys.has(k))) || reachedFloor(pending.oldestAt));
    if (pending.complete !== checkpointComplete) throw new Error("Invalid payout checkpoint completion");
    const priorRows = previous?.rows ?? [];
    const signal = AbortSignal.timeout(20_000);
    const poison = async () => {
      pending.gap ??= { detectedAt: new Date(now()).toISOString(), reason: "feed_invalid" };
      if (previous && !previous.coverage.gap) {
        previous = { ...previous, coverage: { completeCoverageProven: false, gap: pending.gap } };
        pending.baseHash = await save(directory, ARCHIVE, previous);
        original = JSON.stringify(previous);
      }
      await save(directory, PENDING, pending);
    };
    for (let pass = 0; pass < PAGES_PER_PASS && !pending.complete; pass++) {
      const cursor = pending.cursor ?? "";
      if (pending.cursors.includes(cursor) || pending.pages >= MAX_PAGES) {
        await poison(); throw new Error("Payout pagination did not progress");
      }
      const url = new URL(PAYOUT_URL);
      url.searchParams.set("limit", "100"); url.searchParams.set("order", "desc");
      if (pending.cursor !== null) url.searchParams.set("cursor", pending.cursor);
      const response = await request(url.toString(), { redirect: "error", cache: "no-store", signal });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Payout feed HTTP ${response.status}`);
      }
      const capturedAt = now(), date = response.headers.get("date"), age = response.headers.get("age");
      // A stale CDN response is unavailable evidence, like a transport failure.
      // Do not advance the checkpoint or renew freshness; retry next capture.
      // v2 has no generatedAt in its body, so fresh HTTP metadata is required
      // for the head page, which sets the archive's freshness. Cursor pages are
      // older, already-published history that the CDN caches for minutes
      // (max-age=300, served stale past that); requiring them to be fresh would
      // stall every multi-page scan. They still need a sane, non-future Date.
      try {
        if (!pending.pages) {
          checkCaptureTime(date, capturedAt);
          if (age !== null && (!/^\d+$/.test(age) || Number(age) * 1000 > FEED_MAX_AGE_MS))
            throw new Error("Payout response cache is stale");
        } else if (timestamp(date) > capturedAt + 30_000) throw new Error("Payout page clock is invalid");
      } catch (error) { await response.body?.cancel(); throw error; }
      // Transport/body failures are unavailable evidence, not contradictory
      // evidence. Retry the same cursor without refreshing or poisoning history.
      const body = await responseBody(response);
      try {
        const page = payoutPage(body);
        let oldest = pending.oldestAt;
        for (const r of page.rows) {
          if (timestamp(r.createdAt) > capturedAt + 30_000 || (oldest !== null && timestamp(r.createdAt) > timestamp(oldest)))
            throw new Error("Payout page order or clock changed");
          oldest = r.createdAt;
        }
        // Check every row against prior evidence before committing this page.
        mergeRows(priorRows, pending.rows, page.rows);
        const rows = mergeRows(pending.rows, page.rows), keys = new Set(rows.map(payoutKey));
        if (page.nextCursor !== null && (page.nextCursor === cursor || pending.cursors.includes(page.nextCursor)))
          throw new Error("Payout pagination repeated a cursor");
        if (!pending.pages) {
          pending.headAt = new Date(Math.min(capturedAt, timestamp(date))).toISOString();
          pending.headKeys = [...new Set(page.rows.map(payoutKey))];
        }
        pending.rows = rows; pending.oldestAt = oldest; pending.cursors.push(cursor); pending.pages++;
        pending.cursor = page.nextCursor;
        const reachedHead = target.length > 0 && target.every((k) => keys.has(k));
        // Retain the full boundary page. This does not prove completeness of
        // older signatures: totals are retained-row integrity checks only.
        pending.complete = reachedHead || page.nextCursor === null || reachedFloor(oldest);
        if (page.nextCursor === null && target.length && !reachedHead)
          pending.gap ??= { detectedAt: new Date(capturedAt).toISOString(), reason: "window_disjoint" };
        await save(directory, PENDING, pending);
      } catch (error) { await poison(); throw error; }
    }
    if (!pending.complete) throw new Error("Payout history backfill pending; resume on the next capture");
    let archive: HistoryArchive;
    try {
      const rows = mergeRows(priorRows, pending.rows);
      const legacyDistributions = previous?.legacyDistributions ?? [...oldRecords.values()];
      const totals = distributionTotals(rows, legacyDistributions);
      if (!previous && oldRecords.size) {
        const recovered = new Map(distributionTotals(rows, []).map((r) => [r.signature, r]));
        if ([...oldRecords.keys()].some((signature) => !recovered.has(signature)))
          pending.gap ??= { detectedAt: new Date(now()).toISOString(), reason: "window_disjoint" };
      }
      const records = distributions({ data: { recentDistributions: totals } }, FEED_SCOPE);
      for (const [signature, prior] of oldRecords) {
        if (records.get(signature)?.amountRaw !== prior.amountRaw) throw new Error("Published payout total changed");
      }
      archive = historyArchive({ version: 2, source: PAYOUT_URL, fetchedAt: pending.headAt!,
        ...(pending.historyFloor === undefined ? {} : { historyFloor: pending.historyFloor }),
        baselineAt: new Date(Math.min(timestamp(pending.baselineAt), timestamp(pending.headAt!))).toISOString(),
        coverage: { completeCoverageProven: false, gap: pending.gap }, headKeys: pending.headKeys, rows, legacyDistributions,
        data: { recentDistributions: totals } });
    } catch (error) { await poison(); throw error; }
    if (original !== null && !previous) {
      // Preserve the exact old archive, including any latched gap, before migration.
      const backup = join(directory, "payout-feed.pre-v2.json"), existing = await optional(backup);
      if (existing !== null && existing !== original) throw new Error("Legacy archive backup differs; manual review required");
      if (existing === null) {
        const file = await open(backup, "wx", 0o600);
        try { await file.writeFile(original); await file.sync(); } finally { await file.close(); }
      }
    }
    pending.resultHash = hash(JSON.stringify(archive));
    await save(directory, PENDING, pending);
    await save(directory, ARCHIVE, archive);
    await unlink(join(directory, PENDING));
    // A long backfill is published with the original head's time, NOT now. It
    // becomes healthy only after a fresh catch-up scan; gaps never clear here.
    return healthy(archive, now());
  } finally { await rmdir(lock); }
}
