import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { PENIS_MINT, PUMP_MINT } from "../lib/endowment.ts";
import { archiveFeed, assertFeedFresh, FEED_MAX_AGE_MS, readArchivedFeed } from "../lib/holding/feed.ts";
import type { FeedArchive } from "../lib/holding/feed-state.ts";
import type { Distribution } from "../lib/reporter/types.ts";

const start = Date.parse("2026-10-09T12:00:00.000Z");
const other = "11111111111111111111111111111111";
const row = (letter: string, extra: Partial<Distribution> = {}) => ({
  signature: letter.repeat(64), mint: PENIS_MINT, quoteMint: PUMP_MINT, amountRaw: "10", ...extra,
});
const payload = (rows: unknown[], time = start) => ({
  data: { recentDistributions: rows }, meta: { generatedAt: new Date(time).toISOString() },
});
const response = (body: unknown, status = 200): typeof fetch => (async (_url: unknown, options: RequestInit) => {
  assert.equal(options.redirect, "error");
  assert.equal(options.cache, "no-store");
  assert.ok(options.signal instanceof AbortSignal);
  return new Response(JSON.stringify(body), { status });
}) as typeof fetch;
async function directory(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "holding-feed-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function saved(dir: string): Promise<FeedArchive> {
  return JSON.parse(await readFile(join(dir, "payout-feed.json"), "utf8"));
}
const capture = (dir: string, rows: unknown[], now = start) =>
  archiveFeed(dir, { request: response(payload(rows, now)), now: () => now });

test("capture scopes shared signatures, normalizes records and records the global window", async (t) => {
  const dir = await directory(t);
  const rows = [
    { ...row("A"), amountTokens: 0.00001, distributedAt: new Date(start - 5000).toISOString() },
    row("A", { mint: other, amountRaw: "999" }),
    row("B", { mint: other, quoteMint: other }),
  ];
  const records = await capture(dir, rows);
  assert.deepEqual([...records.values()], [row("A")]);
  assert.deepEqual([...await readArchivedFeed(dir, { now: () => start })], [...records]);
  const archive = await saved(dir);
  assert.equal(archive.globalWindow.keys.length, 3);
  assert.equal(archive.globalWindow.oldestAt, new Date(start - 5000).toISOString());
  assert.equal(archive.coverage.completeCoverageProven, false);
  assert.equal(archive.coverage.gap, null);
  assert.equal((await stat(join(dir, "payout-feed.json"))).mode & 0o777, 0o600);
});

test("overlapping windows retain old receipts through restart and ignore changing auxiliary metadata", async (t) => {
  const dir = await directory(t);
  await capture(dir, [{ ...row("A"), holderCount: 3 }, row("B")]);
  await capture(dir, [{ ...row("B"), holderCount: 4 }, row("C")], start + 60_000);
  const archive = await saved(dir);
  assert.equal(archive.baselineAt, new Date(start).toISOString());
  assert.equal(archive.data.recentDistributions.length, 3);
  assert.equal(archive.globalWindow.keys.length, 2);
  assert.equal((await readArchivedFeed(dir, { now: () => start + 61_000 })).size, 3);
  await assertFeedFresh(dir, { now: () => start + 61_000 });
});

test("legacy receipt history survives migration but cannot authorize work before a fresh baseline", async (t) => {
  const dir = await directory(t);
  await writeFile(join(dir, "payout-feed.json"), JSON.stringify({
    fetchedAt: "2025-01-01T00:00:00Z", data: { recentDistributions: [{ ...row("A"), holderCount: 7 }] },
  }));
  await assert.rejects(readArchivedFeed(dir, { now: () => start }), /independent capture baseline/);
  const records = await capture(dir, [row("B")]);
  assert.equal(records.size, 2);
  const archive = await saved(dir);
  assert.equal(archive.baselineAt, new Date(start).toISOString());
  assert.equal(archive.coverage.completeCoverageProven, false);
  assert.equal(archive.coverage.gap, null);
  assert.deepEqual(archive.data.recentDistributions, [row("A"), row("B")]);
});

test("changed relevant amounts poison fresh evidence durably without overwriting accepted receipts", async (t) => {
  const dir = await directory(t);
  await capture(dir, [row("A")]);
  await assert.rejects(capture(dir, [row("A", { amountRaw: "11" })], start + 1000), /record changed/);
  let archive = await saved(dir);
  assert.equal(archive.coverage.gap?.reason, "feed_invalid");
  assert.equal(archive.fetchedAt, new Date(start).toISOString());
  assert.deepEqual(archive.data.recentDistributions, [row("A")]);
  await assert.rejects(readArchivedFeed(dir, { now: () => start + 1001 }), /manual review/);
  await assert.rejects(capture(dir, [row("A"), row("B")], start + 2000), /manual review/);
  archive = await saved(dir);
  assert.equal(archive.coverage.gap?.reason, "feed_invalid");
  assert.equal(archive.data.recentDistributions.length, 2);
});

test("contradictory duplicates and malformed successful responses revoke the previously healthy cache", async (t) => {
  for (const bad of [
    payload([row("A"), row("A", { amountRaw: "12" })], start + 1000),
    { data: {} },
    payload([row("A", { amountRaw: "1.1" })], start + 1000),
  ]) {
    const dir = await directory(t);
    await capture(dir, [row("A")]);
    await assert.rejects(archiveFeed(dir, { request: response(bad), now: () => start + 1000 }));
    assert.equal((await saved(dir)).coverage.gap?.reason, "feed_invalid");
    await assert.rejects(readArchivedFeed(dir, { now: () => start + 1000 }), /manual review/);
  }
});

test("disjoint global windows latch a possible gap even without missing target rows", async (t) => {
  const dir = await directory(t);
  await capture(dir, [row("A", { mint: other })]);
  await assert.rejects(capture(dir, [row("B", { mint: other })], start + 30_000), /manual review/);
  assert.equal((await saved(dir)).coverage.gap?.reason, "window_disjoint");
  await assert.rejects(capture(dir, [row("B", { mint: other }), row("C")], start + 60_000), /manual review/);
  assert.equal((await saved(dir)).data.recentDistributions.length, 1);
  await assert.rejects(readArchivedFeed(dir, { now: () => start + 61_000 }), /manual review/);
});

test("an overdue capture cannot heal itself through overlapping windows", async (t) => {
  const dir = await directory(t);
  await capture(dir, [row("A")]);
  await assertFeedFresh(dir, { now: () => start + FEED_MAX_AGE_MS });
  await assert.rejects(assertFeedFresh(dir, { now: () => start + FEED_MAX_AGE_MS + 1 }), /stale/);
  await assert.rejects(capture(dir, [row("A")], start + FEED_MAX_AGE_MS + 1), /manual review/);
  assert.equal((await saved(dir)).coverage.gap?.reason, "capture_stalled");
});

test("initial empty feeds are healthy, but an unexpected empty window cannot erase continuity", async (t) => {
  const dir = await directory(t);
  assert.equal((await capture(dir, [])).size, 0);
  assert.equal((await readArchivedFeed(dir, { now: () => start })).size, 0);
  await capture(dir, [row("A", { mint: other })], start + 30_000);
  await assert.rejects(capture(dir, [], start + 60_000), /unexpectedly empty/);
  let archive = await saved(dir);
  assert.equal(archive.fetchedAt, new Date(start + 30_000).toISOString());
  assert.equal(archive.globalWindow.keys.length, 1);
  await assert.rejects(capture(dir, [row("A", { mint: other })], start + 151_000), /manual review/);
  archive = await saved(dir);
  assert.equal(archive.coverage.gap?.reason, "capture_stalled");
});

test("stale and future provider timestamps fail capture without accepting response records", async (t) => {
  for (const generatedAt of [start - FEED_MAX_AGE_MS - 1, start + 30_001]) {
    const dir = await directory(t);
    await capture(dir, [row("A")]);
    await assert.rejects(archiveFeed(dir, {
      request: response(payload([row("A"), row("B")], generatedAt)), now: () => start,
    }), /stale|clock/);
    assert.deepEqual((await saved(dir)).data.recentDistributions, [row("A")]);
    await assert.rejects(readArchivedFeed(dir, { now: () => start }), /manual review/);
  }
});

test("transport failures preserve valid evidence only until its ordinary freshness limit", async (t) => {
  const dir = await directory(t);
  await capture(dir, [row("A")]);
  await assert.rejects(archiveFeed(dir, { request: response({}, 503), now: () => start + 1000 }), /HTTP 503/);
  await assertFeedFresh(dir, { now: () => start + 1000 });
  assert.equal((await saved(dir)).coverage.gap, null);
  await assert.rejects(assertFeedFresh(dir, { now: () => start + FEED_MAX_AGE_MS + 1 }), /stale/);
  assert.equal((await saved(dir)).data.recentDistributions.length, 1);
});

test("capture has one independent writer and readers see complete old data while it is waiting", async (t) => {
  const dir = await directory(t);
  await capture(dir, [row("A")]);
  await mkdir(join(dir, "worker.lock"));
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  const first = archiveFeed(dir, {
    now: () => start + 30_000,
    request: (async () => { entered(); await ready; return new Response(JSON.stringify(payload([row("A"), row("B")], start + 30_000))); }) as typeof fetch,
  });
  await started;
  try {
    await assert.rejects(capture(dir, [row("A"), row("C")], start + 30_000), { code: "EEXIST" });
    assert.deepEqual([...(await readArchivedFeed(dir, { now: () => start + 30_000 })).values()], [row("A")]);
  } finally { release(); }
  assert.equal((await first).size, 2);
  assert.equal((await saved(dir)).data.recentDistributions.length, 2);
  await assert.rejects(stat(join(dir, "feed.lock")), { code: "ENOENT" });
  assert.ok((await stat(join(dir, "worker.lock"))).isDirectory());
});

test("partial/corrupt archive metadata never defaults to a healthy empty archive", async (t) => {
  const dir = await directory(t);
  await capture(dir, [row("A")]);
  const original = await saved(dir);
  for (const bad of [
    { ...original, version: 2 },
    { ...original, version: undefined },
    { ...original, coverage: { completeCoverageProven: false } },
    { ...original, coverage: { completeCoverageProven: false, gap: {} } },
    { ...original, globalWindow: { keys: [], oldestAt: "bad", newestAt: null } },
  ]) {
    await writeFile(join(dir, "payout-feed.json"), JSON.stringify(bad));
    await assert.rejects(readArchivedFeed(dir, { now: () => start }));
    await assert.rejects(capture(dir, [row("A")], start + 1000));
  }
  await writeFile(join(dir, "payout-feed.json"), '{"version":1,');
  await assert.rejects(readArchivedFeed(dir, { now: () => start }), SyntaxError);
  await assert.rejects(capture(dir, [row("A")], start + 1000), SyntaxError);
  await writeFile(join(dir, "payout-feed.json"), JSON.stringify(original));
  await writeFile(join(dir, "payout-feed.json.tmp"), '{"version":1,');
  assert.equal((await readArchivedFeed(dir, { now: () => start })).size, 1);
});
