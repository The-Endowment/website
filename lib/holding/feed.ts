import { mkdir, open, readFile, rename, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { distributions } from "../reporter/classify.ts";
import type { Distribution } from "../reporter/types.ts";
import {
  FEED_MAX_AGE_MS, FEED_SCOPE, type FeedArchive, type FeedClock,
  archiveState, checkCaptureTime, feedWindow, requireHealthyArchive,
} from "./feed-state.ts";

export { FEED_MAX_AGE_MS } from "./feed-state.ts";

async function load(directory: string): Promise<unknown> {
  return JSON.parse(await readFile(join(directory, "payout-feed.json"), "utf8"));
}

/** Wallet workers only read. A separate capture process owns the network and
 * archive writer, so a slow wallet pass cannot lose the short public window. */
export async function readArchivedFeed(
  directory: string, { now = Date.now }: FeedClock = {},
): Promise<Map<string, Distribution>> {
  const archive = requireHealthyArchive(await load(directory), now());
  return distributions(archive, FEED_SCOPE);
}

/** Repeat immediately before signing/publishing; never silently refresh here. */
export async function assertFeedFresh(directory: string, options: FeedClock = {}): Promise<void> {
  await readArchivedFeed(directory, options);
}

async function save(directory: string, archive: FeedArchive): Promise<void> {
  const path = join(directory, "payout-feed.json");
  const file = await open(path + ".tmp", "w", 0o600);
  try {
    await file.writeFile(JSON.stringify(archive));
    await file.sync();
  } finally { await file.close(); }
  await rename(path + ".tmp", path);
  const dir = await open(directory, "r");
  try { await dir.sync(); } finally { await dir.close(); }
}

/** Each role captures independently. Entries are API evidence, not proofs.
 * Missing evidence never creates credit. Gaps remain latched for manual review;
 * later successful requests cannot heal them or clear collection.stop. */
export async function archiveFeed(
  directory: string,
  { request = fetch, now = Date.now }: FeedClock & { request?: typeof fetch } = {},
): Promise<Map<string, Distribution>> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, "feed.lock");
  await mkdir(lock, { mode: 0o700 });
  try {
    let cached: unknown = { data: { recentDistributions: [] } };
    try { cached = await load(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const previous = archiveState(cached);
    const records = distributions(cached, FEED_SCOPE);
    const response = await request("https://www.stonkfun.xyz/api/public/v1/rewards?limit=100", {
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Payout feed HTTP ${response.status}`);
    const capturedAt = now();
    const fetchedAt = new Date(capturedAt).toISOString();
    let window;
    try {
      const input: unknown = await response.json();
      const generatedAt = (input as { meta?: { generatedAt?: unknown } })?.meta?.generatedAt;
      if (generatedAt !== undefined) checkCaptureTime(generatedAt, capturedAt);
      window = feedWindow(input);
      const incoming = distributions(input, FEED_SCOPE);
      for (const [signature, entry] of incoming) {
        const prior = records.get(signature);
        if (prior && prior.amountRaw !== entry.amountRaw)
          throw new Error("Public payout record changed; stop and investigate");
        records.set(signature, entry);
      }
    } catch (error) {
      // Contradictory or invalid evidence revokes even a still-fresh cache.
      // A transient transport failure above instead leaves valid evidence usable
      // only until its normal age limit. Never overwrite accepted record values.
      if (previous && !previous.coverage.gap) await save(directory, {
        ...previous, coverage: { completeCoverageProven: false,
          gap: { detectedAt: fetchedAt, reason: "feed_invalid" } },
      });
      throw error;
    }
    // An empty response after a populated window is not evidence that nothing
    // was paid. Keep the previous archive and let freshness expire instead.
    if (previous?.globalWindow.keys.length && !window.keys.length)
      throw new Error("Public payout window unexpectedly empty");
    let gap = previous?.coverage.gap ?? null;
    if (previous) {
      const elapsed = capturedAt - Date.parse(previous.fetchedAt);
      if (elapsed < 0) throw new Error("Payout capture clock moved backwards");
      if (!gap && elapsed > FEED_MAX_AGE_MS)
        gap = { detectedAt: fetchedAt, reason: "capture_stalled" };
      if (!gap && previous.globalWindow.keys.length && window.keys.length
          && !window.keys.some((key) => previous.globalWindow.keys.includes(key)))
        gap = { detectedAt: fetchedAt, reason: "window_disjoint" };
    }
    const archive: FeedArchive = {
      version: 1, fetchedAt, baselineAt: previous?.baselineAt ?? fetchedAt,
      coverage: { completeCoverageProven: false, gap },
      globalWindow: window,
      data: { recentDistributions: [...records.values()] },
    };
    await save(directory, archive);
    // Store new evidence even during a gap, but don't send a healthy heartbeat.
    requireHealthyArchive(archive, capturedAt);
    return records;
  } finally { await rmdir(lock); }
}
