import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { walletPayouts } from "../lib/reporter/payouts.ts";
import { PENIS_MINT, PUMP_MINT } from "../lib/endowment.ts";
import { archiveFeed, assertFeedFresh, FEED_MAX_AGE_MS, readArchivedFeed } from "../lib/holding/feed.ts";
import { PAYOUT_URL, payoutKey, type HistoryArchive, type Payout } from "../lib/holding/payout-history.ts";

const start = Date.parse("2026-10-09T12:00:00.000Z");
const row = (letter: string, extra: Partial<Payout> = {}): Payout => ({
  signature: letter.repeat(64), holder: "H".repeat(32), assetMint: PUMP_MINT,
  amountRaw: "10", createdAt: new Date(start - 5000).toISOString(), ...extra,
});
const evidence = (rows: Payout[], fetchedAt = start) => ({...walletPayouts(rows, {mint: PENIS_MINT, quoteMint: PUMP_MINT}), completedArchive: {fetchedAt: new Date(fetchedAt).toISOString()}});
const total = (letter: string, amountRaw = "10") => ({ signature: letter.repeat(64), mint: PENIS_MINT, quoteMint: PUMP_MINT, amountRaw });
const page = (rows: unknown[], nextCursor: string | null = null) => ({ rows, page: { limit: 100, order: "desc", nextCursor } });
function reply(body: unknown, time = start, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { date: new Date(time).toUTCString(), ...headers } });
}
function responses(bodies: unknown[], time = start): typeof fetch {
  let i = 0;
  return (async (url: string | URL | Request, options?: RequestInit) => {
    assert.ok(String(url).startsWith(PAYOUT_URL + "?limit=100&order=desc"));
    assert.equal(options?.redirect, "error"); assert.equal(options?.cache, "no-store");
    assert.ok(options?.signal instanceof AbortSignal);
    assert.ok(i < bodies.length, "unexpected extra request");
    return reply(bodies[i++], time);
  }) as typeof fetch;
}
async function directory(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "holding-v2-"));
  t.after(() => rm(dir, { recursive: true, force: true })); return dir;
}
async function saved(dir: string): Promise<HistoryArchive> {
  return JSON.parse(await readFile(join(dir, "payout-feed.json"), "utf8"));
}
const capture = (dir: string, rows: unknown[], now = start) => archiveFeed(dir, { request: responses([page(rows)], now), now: () => now });

// v1 migration fixtures deliberately use the deployed archive layout.
function legacy(gap: unknown = null) {
  return { version: 1, fetchedAt: new Date(start - 60000).toISOString(), baselineAt: new Date(start - 60000).toISOString(),
    coverage: { completeCoverageProven: false, gap }, globalWindow: { keys: [], oldestAt: null, newestAt: null },
    data: { recentDistributions: [total("A")] } };
}

test("holder rows spanning pages become one exact transaction total; base payouts are excluded", async (t) => {
  const dir = await directory(t);
  const a = row("A", { amountRaw: "6" }), b = row("A", { holder: "J".repeat(32), amountRaw: "4" });
  const records = await archiveFeed(dir, { now: () => start, request: responses([
    page([a, row("B", { assetMint: PENIS_MINT, amountRaw: "999" })], "opaque+cursor/=1"),
    page([b]),
  ]) });
  assert.deepEqual(records, evidence([a, b]));
  assert.deepEqual((await saved(dir)).data.recentDistributions, [total("A")]);
  assert.deepEqual(await readArchivedFeed(dir, { now: () => start }), records);
  assert.equal((await saved(dir)).rows.length, 3);
  assert.equal((await saved(dir)).coverage.completeCoverageProven, false);
  assert.equal((await stat(join(dir, "payout-feed.json"))).mode & 0o777, 0o600);
});

test("more than 100 new rows are paged back to the prior head instead of declaring a disjoint window", async (t) => {
  const dir = await directory(t); await capture(dir, [row("A")]);
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const burst = Array.from({length: 101}, (_, i) => row("B", {
    holder: "H".repeat(30) + alphabet[Math.floor(i / 58)] + alphabet[i % 58], amountRaw: "1",
  }));
  const records = await archiveFeed(dir, { now: () => start + 30000, request: responses([
    page(burst.slice(0, 100), "next"), page([burst[100], row("A")]),
  ], start + 30000) });
  assert.equal(records.records.size, 102);
  assert.equal((await saved(dir)).data.recentDistributions.find(r => r.signature === "B".repeat(64))!.amountRaw, "101");
  assert.equal((await saved(dir)).coverage.gap, null);
  assert.deepEqual((await saved(dir)).headKeys, burst.slice(0, 100).map(payoutKey));
});

test("all previous head rows must be found, not just one overlapping row", async (t) => {
  const dir = await directory(t); await capture(dir, [row("A"), row("B")]);
  await assert.rejects(archiveFeed(dir, { now: () => start + 1000, request: responses([
    page([row("C"), row("A")], "next"), page([]),
  ], start + 1000) }), /manual review/);
  assert.equal((await saved(dir)).coverage.gap?.reason, "window_disjoint");
  await assert.rejects(readArchivedFeed(dir, { now: () => start + 1000 }), /manual review/);
  await assert.rejects(capture(dir, [row("C"), row("A"), row("B")], start + 2000), /manual review/);
});

test("cold backfill is bounded and resumes on the next process without publishing a partial total", async (t) => {
  const dir = await directory(t);
  const rows = "ABCDEFG".split("").map((x) => row("A", { holder: x.repeat(32), amountRaw: "1" }));
  await assert.rejects(archiveFeed(dir, { now: () => start, request: responses(rows.slice(0, 5).map((r, i) => page([r], `cursor-${i}`))) }), /backfill pending/);
  await assert.rejects(readArchivedFeed(dir, { now: () => start }), { code: "ENOENT" });
  let calls = 0;
  const request = (async (url: string) => {
    assert.equal(new URL(url).searchParams.get("cursor"), calls === 0 ? "cursor-4" : "last");
    return reply(calls++ === 0 ? page([rows[5]], "last") : page([rows[6]]), start + 30000);
  }) as typeof fetch;
  const result = await archiveFeed(dir, { now: () => start + 30000, request });
  assert.equal(result.records.size, 7);
  assert.deepEqual((await saved(dir)).data.recentDistributions, [total("A", "7")]);
  assert.equal((await saved(dir)).fetchedAt, new Date(start).toISOString());
  assert.equal(result.completedArchive?.fetchedAt, new Date(start).toISOString());
  await assert.rejects(stat(join(dir, "payout-history-pending.json")), { code: "ENOENT" });
});

test("a long backfill cannot refresh history until a new scan catches up to the live head", async (t) => {
  const dir = await directory(t);
  await assert.rejects(archiveFeed(dir, { now: () => start, request: responses("ABCDE".split("").map((x, i) => page([row(x)], `p${i}`))) }), /backfill pending/);
  const late = start + 180000;
  await assert.rejects(archiveFeed(dir, { now: () => late, request: responses([page([row("F")])], late) }), /stale/);
  assert.equal((await saved(dir)).fetchedAt, new Date(start).toISOString());
  const r = await archiveFeed(dir, { now: () => late + 1000, request: responses([page([row("G"), row("A")], "unused")], late + 1000) });
  assert.equal(r.records.size, 7); assert.equal((await saved(dir)).coverage.gap, null);
});

test("an outage can catch up through history without clearing any collector stop file", async (t) => {
  const dir = await directory(t); await capture(dir, [row("A")]);
  await writeFile(join(dir, "collection.stop"), "operator clearance required");
  await assert.rejects(assertFeedFresh(dir, { now: () => start + FEED_MAX_AGE_MS + 1 }), /stale/);
  await archiveFeed(dir, { now: () => start + 180000, request: responses([
    page([row("B")], "next"), page([row("A")]),
  ], start + 180000) });
  assert.equal((await saved(dir)).coverage.gap, null);
  assert.equal(await readFile(join(dir, "collection.stop"), "utf8"), "operator clearance required");
});

test("short and empty intermediate pages follow nextCursor; only null means history end", async (t) => {
  const dir = await directory(t);
  const r = await archiveFeed(dir, { now: () => start, request: responses([
    page([row("A")], "a"), page([], "b"), page([row("B")]),
  ]) });
  assert.equal(r.records.size, 2);
});

test("exact duplicate holder rows do not inflate transaction totals", async (t) => {
  const dir = await directory(t);
  const r = await archiveFeed(dir, { now: () => start, request: responses([
    page([row("A"), row("A")], "next"), page([row("A"), row("B")]),
  ]) });
  assert.deepEqual(r, evidence([row("A"), row("B")]));
});

test("changed holder amounts poison a previously healthy archive without replacing accepted data", async (t) => {
  const dir = await directory(t); await capture(dir, [row("A")]);
  await assert.rejects(capture(dir, [row("A", { amountRaw: "11" })], start + 1000), /record changed/);
  assert.equal((await saved(dir)).coverage.gap?.reason, "feed_invalid");
  assert.deepEqual((await saved(dir)).data.recentDistributions, [total("A")]);
  await assert.rejects(readArchivedFeed(dir, { now: () => start + 1000 }), /manual review/);
});

test("new rows for a previously published signature cannot silently change a finalized total", async (t) => {
  const dir = await directory(t); await capture(dir, [row("A")]);
  await assert.rejects(capture(dir, [row("A", { holder: "J".repeat(32) }), row("A")], start + 1000), /total changed/);
  assert.deepEqual((await saved(dir)).data.recentDistributions, [total("A")]);
  assert.equal((await saved(dir)).coverage.gap?.reason, "feed_invalid");
});

test("malformed pages, amounts, order and cursors never publish new eligibility", async (t) => {
  for (const body of [
    {}, { rows: [], page: { order: "desc", limit: 100 } }, page([row("A", { amountRaw: "1.1" })]),
    page([row("A", { amountRaw: (1n << 64n).toString() })]),
    page([row("A", { holder: "bad" })]), page([row("A"), row("A", { amountRaw: "11" })]),
    { ...page([row("A")]), page: { order: "asc", limit: 100, nextCursor: null } },
    page([row("A", { createdAt: new Date(start + 30001).toISOString() })]),
    page([row("B"), row("C", { createdAt: new Date(start - 1000).toISOString() })]),
  ]) {
    const dir = await directory(t); await capture(dir, [row("A")]);
    await assert.rejects(archiveFeed(dir, { now: () => start + 100, request: responses([body], start) }));
    assert.equal((await saved(dir)).coverage.gap?.reason, "feed_invalid");
    assert.deepEqual((await saved(dir)).data.recentDistributions, [total("A")]);
  }
});

test("cursor loops fail rather than retrying a page forever", async (t) => {
  const dir = await directory(t);
  await assert.rejects(archiveFeed(dir, { now: () => start, request: responses([
    page([row("A")], "loop"), page([row("B")], "loop"),
  ]) }), /repeated a cursor/);
  await assert.rejects(readArchivedFeed(dir, { now: () => start }), { code: "ENOENT" });
});

test("HTTP failure after a page retains the cursor and does not refresh the published archive", async (t) => {
  const dir = await directory(t); await capture(dir, [row("A")]);
  let calls = 0;
  await assert.rejects(archiveFeed(dir, { now: () => start + 1000, request: (async () =>
    ++calls === 1 ? reply(page([row("B")], "resume"), start + 1000) : reply({}, start, 503)) as typeof fetch }), /HTTP 503/);
  assert.equal((await saved(dir)).fetchedAt, new Date(start).toISOString());
  await assertFeedFresh(dir, { now: () => start + 1000 });
  await archiveFeed(dir, { now: () => start + 30000, request: (async (url: string) => {
    assert.equal(new URL(url).searchParams.get("cursor"), "resume"); return reply(page([row("A")]), start + 30000);
  }) as typeof fetch });
  assert.equal((await saved(dir)).data.recentDistributions.length, 2);
});

test("missing, stale and future cache timestamps reject cached v2 responses", async (t) => {
  const cases: Record<string, string>[] = [{ date: "" }, { date: new Date(start - 121000).toUTCString() },
    { date: new Date(start + 31000).toUTCString() }, { age: "121" }, { age: "invalid" }];
  for (const headers of cases) {
    const dir = await directory(t); await capture(dir, [row("A")]);
    await assert.rejects(archiveFeed(dir, { now: () => start, request: (async () => reply(page([row("A")]), start, 200, headers)) as typeof fetch }));
    assert.equal((await saved(dir)).fetchedAt, new Date(start).toISOString());
    await assertFeedFresh(dir, { now: () => start });
    await assert.rejects(assertFeedFresh(dir, { now: () => start + FEED_MAX_AGE_MS + 1 }), /stale/);
  }
});

test("CDN-cached cursor pages complete a scan; only the head page sets freshness", async (t) => {
  // Live StonkFun: head max-age=30, cursor pages max-age=300 and served stale ~13 min old.
  const twoPages = (cursorHeaders: Record<string, string>, cursorTime: number) => (async (url: string) =>
    new URL(url).searchParams.get("cursor") === null
      ? reply(page([row("B")], "older"), start, 200, { age: "20" })
      : reply(page([row("A")]), cursorTime, 200, cursorHeaders)) as typeof fetch;
  const dir = await directory(t);
  const result = await archiveFeed(dir, { now: () => start, request: twoPages({ age: "786" }, start - 787000) });
  assert.equal(result.records.size, 2);
  assert.equal((await saved(dir)).fetchedAt, new Date(start).toISOString());
  await assertFeedFresh(dir, { now: () => start });
  for (const [headers, time] of [[{ date: "" }, start], [{}, start + 31000]] as const) {
    const bad = await directory(t);
    await assert.rejects(archiveFeed(bad, { now: () => start, request: twoPages(headers, time) }));
    await assert.rejects(stat(join(bad, "payout-feed.json")), { code: "ENOENT" });
  }
});

test("migration preserves original v1 bytes, legacy receipts, and a latched gap", async (t) => {
  for (const gap of [null, { detectedAt: new Date(start - 1000).toISOString(), reason: "window_disjoint" }]) {
    const dir = await directory(t); const old = JSON.stringify(legacy(gap));
    await writeFile(join(dir, "payout-feed.json"), old);
    await assert.rejects(readArchivedFeed(dir, { now: () => start }), /v2 baseline/);
    if (gap) await assert.rejects(capture(dir, [row("A"), row("B")]), /manual review/);
    else await capture(dir, [row("A"), row("B")]);
    assert.equal(await readFile(join(dir, "payout-feed.pre-v2.json"), "utf8"), old);
    assert.deepEqual((await saved(dir)).data.recentDistributions, [total("A"), total("B")]);
    assert.deepEqual((await saved(dir)).coverage.gap, gap);
  }
});

test("legacy amount conflicts fail migration without overwriting the legacy archive", async (t) => {
  const dir = await directory(t); const old = JSON.stringify(legacy()); await writeFile(join(dir, "payout-feed.json"), old);
  await assert.rejects(capture(dir, [row("A", { amountRaw: "9" })]), /Legacy payout total changed/);
  assert.equal(await readFile(join(dir, "payout-feed.json"), "utf8"), old);
});

test("initial empty history is allowed, but disappearance of previously seen rows latches a gap", async (t) => {
  const dir = await directory(t); assert.equal((await capture(dir, [])).records.size, 0);
  await capture(dir, [row("A")], start + 1000);
  await assert.rejects(capture(dir, [], start + 2000), /manual review/);
  assert.equal((await saved(dir)).coverage.gap?.reason, "window_disjoint");
});

test("single-writer lock protects capture; readers retain a complete old archive during pagination", async (t) => {
  const dir = await directory(t); await capture(dir, [row("A")]); await mkdir(join(dir, "worker.lock"));
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => { entered = r; }), ready = new Promise<void>((r) => { release = r; });
  const first = archiveFeed(dir, { now: () => start + 30000, request: (async () => {
    entered(); await ready; return reply(page([row("B"), row("A")]), start + 30000);
  }) as typeof fetch });
  await started;
  try {
    await assert.rejects(capture(dir, [row("C")]), { code: "EEXIST" });
    assert.deepEqual(await readArchivedFeed(dir, { now: () => start + 30000 }), evidence([row("A")]));
  } finally { release(); }
  assert.equal((await first).records.size, 2);
  assert.ok((await stat(join(dir, "worker.lock"))).isDirectory());
});

test("corrupted archive totals, source, metadata and checkpoint bindings fail closed", async (t) => {
  const dir = await directory(t); await capture(dir, [row("A")]); const original = await saved(dir);
  for (const bad of [
    { ...original, source: PAYOUT_URL + '/wrong' }, { ...original, version: 99 },
    { ...original, data: { recentDistributions: [total("A", "99")] } },
    { ...original, coverage: { completeCoverageProven: false } },
    { ...original, headKeys: ['unknown'] }, { ...original, rows: [] },
  ]) {
    await writeFile(join(dir, "payout-feed.json"), JSON.stringify(bad));
    await assert.rejects(readArchivedFeed(dir, { now: () => start }));
    await assert.rejects(capture(dir, [row("A")]));
  }
  await writeFile(join(dir, "payout-feed.json"), JSON.stringify(original));
  await writeFile(join(dir, "payout-history-pending.json"), JSON.stringify({ version: 1, baseHash: 'wrong' }));
  await assert.rejects(capture(dir, [row("A")]), /Invalid payout checkpoint/);
});

test("restart after atomic publication removes only the already-committed checkpoint", async (t) => {
  const dir = await directory(t); await capture(dir, [row("A")]);
  const text = await readFile(join(dir, "payout-feed.json"), "utf8");
  await writeFile(join(dir, "payout-history-pending.json"), JSON.stringify({ resultHash: createHash('sha256').update(text).digest('hex') }));
  const records = await archiveFeed(dir, { now: () => start, request: (async () => { throw new Error('must not fetch'); }) as typeof fetch });
  assert.equal(records.records.size, 1);
  await assert.rejects(stat(join(dir, "payout-history-pending.json")), { code: "ENOENT" });
});

test("migration cannot report healthy if v2 no longer returns a previously accepted legacy payout", async (t) => {
  const dir = await directory(t); await writeFile(join(dir, "payout-feed.json"), JSON.stringify(legacy()));
  await assert.rejects(capture(dir, [row("B")]), /manual review/);
  assert.deepEqual((await saved(dir)).data.recentDistributions, [total("A"), total("B")]);
  assert.equal((await saved(dir)).coverage.gap?.reason, "window_disjoint");
});

test("aggregate overflow is rejected even though each individual holder amount fits u64", async (t) => {
  const dir = await directory(t);
  await assert.rejects(capture(dir, [row("A", {amountRaw: ((1n << 64n) - 1n).toString()}),
    row("A", {holder: "J".repeat(32), amountRaw: "1"})]), /exceeds u64/);
  await assert.rejects(readArchivedFeed(dir, {now: () => start}), {code: "ENOENT"});
});

test("oversized responses cannot overwrite previously accepted evidence", async (t) => {
  const dir = await directory(t); await capture(dir, [row("A")]);
  await assert.rejects(archiveFeed(dir, {now: () => start, request: (async () =>
    new Response(' '.repeat(2_000_001), {headers: {date: new Date(start).toUTCString(), "content-type": "application/json"}})) as typeof fetch}), /too large/);
  assert.deepEqual((await saved(dir)).data.recentDistributions, [total("A")]);
  assert.equal((await saved(dir)).coverage.gap, null);
  await assertFeedFresh(dir, {now: () => start});
});

test("a damaged completion marker cannot publish a checkpoint that still has pages to read", async (t) => {
  const dir = await directory(t);
  await assert.rejects(archiveFeed(dir, {now: () => start, request: responses(
    'ABCDE'.split('').map((x, i) => page([row(x)], `p${i}`)))}), /backfill pending/);
  const path = join(dir, 'payout-history-pending.json');
  const pending = JSON.parse(await readFile(path, 'utf8')); pending.complete = true;
  await writeFile(path, JSON.stringify(pending));
  await assert.rejects(capture(dir, [row('F')]), /checkpoint completion/);
  await assert.rejects(readArchivedFeed(dir, {now: () => start}), {code: 'ENOENT'});
});

test("legacy transaction totals cannot fill absent holder evidence in a completed v2 archive", async t => {
  const dir = await directory(t); await capture(dir,[row("A")]);
  const archive = await saved(dir);
  archive.legacyDistributions = [total("B")];
  archive.data.recentDistributions.push(total("B"));
  await writeFile(join(dir,"payout-feed.json"),JSON.stringify(archive));
  const records = await readArchivedFeed(dir,{now:()=>start});
  assert.deepEqual(records,evidence([row("A")]));
  assert.equal([...records.records.values()].some(r=>r.signature === "B".repeat(64)),false);
});

test("malformed JSON, aborted bodies and HTML 200 retry the saved cursor without poisoning or renewing evidence", async t => {
  for (const failure of ["json", "abort", "html", "disguised-html", "missing-type"]) {
    const dir = await directory(t); await capture(dir, [row("A")]);
    const original = await readFile(join(dir, "payout-feed.json"), "utf8");
    let calls = 0;
    const request = (async () => {
      if (++calls === 1) return reply(page([row("B")], "resume"), start + 1000);
      const headers = { date: new Date(start + 1000).toUTCString(), "content-type": "application/json" };
      if (failure === "abort") return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('{"rows":[')); },
        pull(controller) { controller.error(new DOMException("Timed out reading body", "TimeoutError")); },
      }), { headers });
      if (failure === "html") headers["content-type"] = "text/html";
      if (failure === "missing-type") return new Response(null, { headers: {date: headers.date} });
      return new Response(failure === "json" ? '{"rows":[' : '<html>Temporary upstream error</html>', { headers });
    }) as typeof fetch;
    await assert.rejects(archiveFeed(dir, {now: () => start + 1000, request}));
    assert.equal(await readFile(join(dir, "payout-feed.json"), "utf8"), original);
    const checkpoint = JSON.parse(await readFile(join(dir, "payout-history-pending.json"), "utf8"));
    assert.equal(checkpoint.gap, null);
    assert.equal(checkpoint.cursor, "resume"); assert.equal(checkpoint.pages, 1);
    assert.deepEqual(checkpoint.rows, [row("B")]);
    await assert.rejects(assertFeedFresh(dir, {now: () => start + FEED_MAX_AGE_MS + 1}), /stale/);
    await archiveFeed(dir, {now: () => start + 30000, request: (async (url: string) => {
      assert.equal(new URL(url).searchParams.get("cursor"), "resume");
      return reply(page([row("A")]), start + 30000);
    }) as typeof fetch});
    assert.equal((await saved(dir)).coverage.gap, null);
    assert.equal((await saved(dir)).rows.length, 2);
    assert.equal((await saved(dir)).fetchedAt, new Date(start + 1000).toISOString());
  }
});

const floorAt = new Date(start - 60000).toISOString();
const oldRow = (letter: string) => row(letter, {createdAt: new Date(start - 120000).toISOString()});
test("explicit cold history floor keeps rows at or after it, stops before older pages and persists across captures", async t => {
  const dir = await directory(t);
  const result = await archiveFeed(dir, {historyFloor: floorAt, now: () => start, request: responses([
    page([row("A")], "boundary"), page([row("B", {createdAt: floorAt}), oldRow("C")], "not-fetched"),
  ])});
  assert.equal(result.records.size, 2);
  assert.equal((await saved(dir)).historyFloor, floorAt);
  assert.deepEqual((await saved(dir)).rows, [row("A"), row("B", {createdAt: floorAt})]);
  await capture(dir, [row("D"), row("A")], start + 30000);
  assert.equal((await saved(dir)).historyFloor, floorAt);
  assert.equal((await saved(dir)).rows.length, 3); // no pruning above the floor
});

test("a below-floor transaction cut at the floor page boundary never becomes a published total", async t => {
  // Live shape: 17 holder rows of one signature span two pages; the floor stop
  // keeps 8, and a later scan's boundary page returns the other 9.
  const dir = await directory(t);
  const holders = Array.from({length: 17}, (_, i) => row("X", {
    holder: "H".repeat(31) + "ABCDEFGHJKLMNPQRS"[i], createdAt: oldRow("X").createdAt}));
  await archiveFeed(dir, {historyFloor: floorAt, now: () => start, request: responses([
    page([row("A"), ...holders.slice(0, 8)], "rest-of-X"),
  ])});
  assert.deepEqual((await saved(dir)).rows, [row("A")]);
  assert.deepEqual((await saved(dir)).headKeys, [payoutKey(row("A"))]);
  assert.deepEqual((await saved(dir)).data.recentDistributions, [total("A")]);
  await archiveFeed(dir, {now: () => start + 30000, request: responses([
    page([row("N")], "p1"), page([row("A"), ...holders.slice(8)], "older"),
  ], start + 30000)});
  const archive = await saved(dir);
  assert.equal(archive.coverage.gap, null);
  assert.deepEqual(archive.rows.map((r) => r.signature[0]).sort(), ["A", "N"]);
  assert.deepEqual(archive.data.recentDistributions.map((r) => r.signature[0]).sort(), ["A", "N"]);
});

test("an archive holding rows below its floor is rejected", async t => {
  const dir = await directory(t);
  await archiveFeed(dir, {historyFloor: floorAt, now: () => start, request: responses([page([row("A"), oldRow("B")], "unused")])});
  const archive = await saved(dir);
  archive.rows.push(oldRow("B")); archive.data.recentDistributions.push(total("B"));
  await writeFile(join(dir, "payout-feed.json"), JSON.stringify(archive));
  await assert.rejects(readArchivedFeed(dir, {now: () => start}), /below its floor/);
});

test("history floor is strictly older, does not infer end on an empty page, and resumes after restart", async t => {
  const dir = await directory(t);
  const atFloor = row("A", {createdAt: floorAt});
  await assert.rejects(archiveFeed(dir, {historyFloor: floorAt, now: () => start, request: responses([
    page([atFloor], "p1"), page([], "p2"), page([], "p3"), page([], "p4"), page([], "p5"),
  ])}), /backfill pending/);
  assert.equal(JSON.parse(await readFile(join(dir, "payout-history-pending.json"), "utf8")).historyFloor, floorAt);
  await archiveFeed(dir, {now: () => start + 30000, request: responses([page([oldRow("B")], "unused")], start + 30000)});
  assert.equal((await saved(dir)).rows.length, 1);
  assert.equal((await saved(dir)).historyFloor, floorAt);
});

test("floor cannot satisfy missing prior head rows or clear a gap", async t => {
  const dir = await directory(t);
  await archiveFeed(dir, {historyFloor: floorAt, now: () => start, request: responses([page([row("A"), row("B"), oldRow("Z")], "unused")])});
  await assert.rejects(archiveFeed(dir, {now: () => start + 1000, request: responses([
    page([row("A"), oldRow("C")], "must-continue"), page([]),
  ], start + 1000)}), /manual review/);
  assert.equal((await saved(dir)).coverage.gap?.reason, "window_disjoint");
});

test("floor refuses existing archives, journals, pending transactions and stop files", async t => {
  for (const name of ["wallet.json", "settlements", "collection.stop", "health.json"]) {
    const dir = await directory(t); await writeFile(join(dir, name), "preserve");
    await assert.rejects(archiveFeed(dir, {historyFloor: floorAt, now: () => start}), /fresh role directory/);
    assert.equal(await readFile(join(dir, name), "utf8"), "preserve");
  }
  for (const version of [1, 2]) {
    const dir = await directory(t);
    if (version === 1) await writeFile(join(dir, "payout-feed.json"), JSON.stringify(legacy()));
    else await capture(dir, [row("A")]);
    const bytes = await readFile(join(dir, "payout-feed.json"), "utf8");
    await assert.rejects(archiveFeed(dir, {historyFloor: floorAt, now: () => start}), /immutable/);
    assert.equal(await readFile(join(dir, "payout-feed.json"), "utf8"), bytes);
  }
});

test("floor cannot change on a completed archive or unfinished checkpoint, and invalid or future floors fail", async t => {
  for (const unfinished of [false, true]) {
    const dir = await directory(t);
    const captureFloor = archiveFeed(dir, {historyFloor: floorAt, now: () => start, request: responses(
      unfinished ? 'ABCDE'.split('').map((s,i) => page([row(s)], `p${i}`)) : [page([oldRow("A")], "unused")])});
    if (unfinished) await assert.rejects(captureFloor, /backfill pending/); else await captureFloor;
    const path = join(dir, unfinished ? "payout-history-pending.json" : "payout-feed.json");
    const bytes = await readFile(path, "utf8");
    await assert.rejects(archiveFeed(dir, {historyFloor: new Date(start - 30000).toISOString(), now: () => start}), /immutable/);
    assert.equal(await readFile(path, "utf8"), bytes);
  }
  for (const invalid of ["", "not a date", new Date(start + 1000).toISOString()]) {
    const dir = await directory(t);
    await assert.rejects(archiveFeed(dir, {historyFloor: invalid, now: () => start}));
    await assert.rejects(saved(dir), {code: "ENOENT"});
  }
});

test("damaged checkpoint oldest time cannot falsely complete a floor-limited backfill", async t => {
  const dir = await directory(t);
  await assert.rejects(archiveFeed(dir, {historyFloor: floorAt, now: () => start, request: responses(
    'ABCDE'.split('').map((s,i) => page([row(s)], `p${i}`)))}), /backfill pending/);
  const path = join(dir, "payout-history-pending.json");
  const checkpoint = JSON.parse(await readFile(path, "utf8"));
  checkpoint.oldestAt = oldRow("A").createdAt;
  checkpoint.complete = true;
  await writeFile(path, JSON.stringify(checkpoint));
  await assert.rejects(archiveFeed(dir, {now: () => start}), /checkpoint oldest row/);
  await assert.rejects(saved(dir), {code: "ENOENT"});
});
