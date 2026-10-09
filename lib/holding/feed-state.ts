import { PENIS_MINT, PUMP_MINT } from "../endowment.ts";
import { distributions } from "../reporter/classify.ts";
import type { Distribution } from "../reporter/types.ts";

export const FEED_SCOPE = { mint: PENIS_MINT, quoteMint: PUMP_MINT };
export const FEED_MAX_AGE_MS = 120_000;
export type FeedClock = { now?: () => number };
type Gap = { detectedAt: string; reason: "capture_stalled" | "window_disjoint" | "feed_invalid" };
type Window = { keys: string[]; oldestAt: string | null; newestAt: string | null };
export type FeedArchive = {
  version: 1; fetchedAt: string; baselineAt: string;
  coverage: { completeCoverageProven: false; gap: Gap | null };
  globalWindow: Window;
  data: { recentDistributions: Distribution[] };
};

function timestamp(value: unknown): number {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new Error("Invalid payout feed timestamp");
  return Date.parse(value);
}

/** Reject stale upstream cached responses as well as stale local archives. */
export function checkCaptureTime(value: unknown, now: number): void {
  const time = timestamp(value);
  if (!Number.isFinite(now) || time > now + 30_000 || now - time > FEED_MAX_AGE_MS)
    throw new Error("Payout feed is stale or its clock is invalid");
}

/** Shared signatures are normal. Continuity follows the global window, using
 * generating mint and quote mint to keep each transaction's entries distinct. */
export function feedWindow(input: unknown): Window {
  const entries = (input as { data?: { recentDistributions?: unknown } })?.data?.recentDistributions;
  if (!Array.isArray(entries)) throw new Error("Missing recent distribution records");
  const keys = new Set<string>();
  const times: number[] = [];
  for (const entry of entries) {
    if (!entry || ![entry.signature, entry.mint, entry.quoteMint]
      .every((value) => typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(value)))
      throw new Error("Malformed distribution identity");
    keys.add(`${entry.signature}:${entry.mint}:${entry.quoteMint}`);
    if (entry.distributedAt !== undefined) times.push(timestamp(entry.distributedAt));
  }
  return {
    keys: [...keys],
    oldestAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    newestAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
  };
}

/** A legacy cache preserves its receipt history but starts a new observable
 * baseline. Neither migration nor the first capture proves earlier coverage. */
export function archiveState(input: unknown): FeedArchive | null {
  const value = input as Partial<FeedArchive>;
  if (!value || typeof value !== "object") throw new Error("Invalid payout archive");
  if (value.version === undefined) {
    if ("coverage" in value || "globalWindow" in value || "baselineAt" in value)
      throw new Error("Payout archive version is missing");
    distributions(input, FEED_SCOPE);
    return null;
  }
  if (value.version !== 1 || value.coverage?.completeCoverageProven !== false
      || !value.globalWindow || !Array.isArray(value.globalWindow.keys)
      || !value.globalWindow.keys.every((key) => typeof key === "string"
        && /^[1-9A-HJ-NP-Za-km-z]{32,88}:[1-9A-HJ-NP-Za-km-z]{32,88}:[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(key)))
    throw new Error("Invalid payout archive metadata");
  const fetchedAt = timestamp(value.fetchedAt);
  if (timestamp(value.baselineAt) > fetchedAt) throw new Error("Invalid payout archive baseline");
  for (const time of [value.globalWindow.oldestAt, value.globalWindow.newestAt])
    if (time !== null) timestamp(time);
  const gap = value.coverage.gap;
  if (gap !== null) {
    if (!gap || !["capture_stalled", "window_disjoint", "feed_invalid"].includes(gap.reason)
        || timestamp(gap.detectedAt) < timestamp(value.baselineAt))
      throw new Error("Invalid payout archive gap");
  }
  distributions(input, FEED_SCOPE);
  return value as FeedArchive;
}

export function requireHealthyArchive(input: unknown, now: number): FeedArchive {
  const archive = archiveState(input);
  if (!archive) throw new Error("Payout archive needs an independent capture baseline");
  checkCaptureTime(archive.fetchedAt, now);
  if (archive.coverage.gap) throw new Error("Possible payout feed gap; manual review required");
  return archive;
}
