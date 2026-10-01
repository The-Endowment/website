import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dailySanity, parseDistribution, parseSnapshot, type DailySnapshot } from "../lib/daily-sanity.ts";
import { saveDailyCheck } from "../scripts/daily-sanity.mts";

const start: DailySnapshot = {
  version: 1, program: "program", config: "endowment", coinMint: "PENIS", rewardMint: "PUMP",
  observedAt: "2026-09-30T00:00:00.000Z", apiGeneratedAt: "2026-09-30T00:00:00.000Z",
  slot: "1000", distributedRaw: "1000000000000", totalSweptRaw: "200000000000",
  committedBps: 3000, lastCountAt: "1790726400", fundingState: "enabled",
};
const end: DailySnapshot = {
  ...start, observedAt: "2026-10-01T00:00:00.000Z", apiGeneratedAt: "2026-10-01T00:00:00.000Z",
  slot: "2000", distributedRaw: "1100000000000", totalSweptRaw: "230000000000",
};

test("first observation is a baseline, not a successful daily check", () => {
  const report = dailySanity(null, start);
  assert.equal(report.status, "baseline");
  assert.equal(report.collectedPumpRaw, null);
});

test("100,000 PUMP distributed at 30% estimates 30,000; uses cumulative collections", () => {
  const report = dailySanity(start, end);
  assert.equal(report.status, "within_range");
  assert.equal(report.distributedPumpRaw, "100000000000");
  assert.equal(report.estimatedPenisPumpRaw, "30000000000");
  assert.equal(report.collectedPumpRaw, "30000000000");
  assert.equal(report.differenceRaw, "0");
  // Neither a purchase, treasury reward nor donation changes the collection counter.
  assert.deepEqual(dailySanity(start, { ...end, pumpVaultBalance: "0", totalSpent: "999999" } as DailySnapshot), report);
});

test("large shortfalls and surpluses request review; tolerance boundary is inclusive", () => {
  assert.equal(dailySanity(start, { ...end, totalSweptRaw: start.totalSweptRaw }).status, "review");
  assert.equal(dailySanity(start, { ...end, totalSweptRaw: "215000000000" }).status, "within_range");
  assert.equal(dailySanity(start, { ...end, totalSweptRaw: "214999999999" }).status, "review");
  const excess = dailySanity(start, { ...end, totalSweptRaw: "250000000000" });
  assert.equal(excess.status, "review");
  assert.match(excess.notes.join(" "), /other coins/);
});

test("amount arithmetic remains exact above JavaScript's safe integer range", () => {
  const large = 900719925474099312345n;
  const a = { ...start, distributedRaw: large.toString(), totalSweptRaw: large.toString() };
  const b = { ...end, distributedRaw: (large + 100000n).toString(), totalSweptRaw: (large + 30000n).toString() };
  assert.equal(dailySanity(a, b).differenceRaw, "0");
});

test("changed commitment uses an explicitly approximate endpoint mean", () => {
  const report = dailySanity(start, { ...end, committedBps: 4000 });
  assert.equal(report.estimatedPenisPumpRaw, "35000000000");
  assert.match(report.notes.join(" "), /mean/);
});

test("inactive, paused, stale, unavailable and completed endpoints have no full-day estimate", () => {
  for (const fundingState of ["waiting", "paused", "stale", "unavailable", "complete", "retired"]) {
    for (const report of [dailySanity({ ...start, fundingState }, end), dailySanity(start, { ...end, fundingState })]) {
      assert.equal(report.status, "inconclusive");
      assert.equal(report.estimatedPenisPumpRaw, null);
      assert.equal(report.collectedPumpRaw, "30000000000");
    }
  }
});

test("no payout and no collection cannot report a working collector", () => {
  assert.equal(dailySanity(start, { ...end, distributedRaw: start.distributedRaw, totalSweptRaw: start.totalSweptRaw }).status, "no_activity");
  assert.equal(dailySanity(start, { ...end, distributedRaw: start.distributedRaw }).status, "review");
});

test("missed and reversed daily intervals are inconclusive", () => {
  const late = { ...end, observedAt: "2026-10-02T00:00:00.000Z", apiGeneratedAt: "2026-10-02T00:00:00.000Z" };
  assert.equal(dailySanity(start, late).status, "inconclusive");
  assert.equal(dailySanity(end, start).status, "inconclusive");
});

test("reset counters, regressing slots and changed instances never look healthy", () => {
  for (const replacement of [{ distributedRaw: "0" }, { totalSweptRaw: "0" }, { slot: "1" }, { config: "different" }, { rewardMint: "STONK" }]) {
    const report = dailySanity(start, { ...end, ...replacement });
    assert.equal(report.status, "inconclusive");
    assert.equal(report.estimatedPenisPumpRaw, null);
  }
});

test("malformed or stale snapshots fail instead of substituting zeroes", () => {
  for (const change of [{ totalSweptRaw: 1 }, { distributedRaw: "-1" }, { committedBps: 10001 }, { committedBps: NaN },
    { apiGeneratedAt: start.apiGeneratedAt }, { apiGeneratedAt: "2026-10-01T00:02:00.000Z" }, { version: 2 }]) {
    assert.throws(() => parseSnapshot({ ...end, ...change }));
  }
  assert.throws(() => dailySanity(start, end, NaN));
});

test("API parser checks both mints, decimals and raw integer amounts", () => {
  const response = { data: { mint: "PENIS", quote: { mint: "PUMP", decimals: 6 }, rewards: { distributedRaw: "12345678901234567" } }, meta: { generatedAt: end.apiGeneratedAt } };
  assert.equal(parseDistribution(response, "PENIS", "PUMP").distributedRaw, "12345678901234567");
  assert.throws(() => parseDistribution(response, "OTHER", "PUMP"));
  assert.throws(() => parseDistribution(response, "PENIS", "STONK"));
  assert.throws(() => parseDistribution({ ...response, data: { ...response.data, rewards: { distributedRaw: 123 } } }, "PENIS", "PUMP"));
  assert.throws(() => parseDistribution(null, "PENIS", "PUMP"));
});

test("daily files persist across restarts; same-day retries preserve the first boundary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "daily-sanity-"));
  try {
    const baseline = await saveDailyCheck(directory, async () => start, new Date(start.observedAt));
    assert.equal(baseline.report.status, "baseline");
    const result = await saveDailyCheck(directory, async () => end, new Date(end.observedAt));
    assert.equal(result.report.status, "within_range");
    const retry = await saveDailyCheck(directory, async () => { throw new Error("Must not fetch again"); }, new Date(end.observedAt));
    assert.deepEqual(result, retry);
    assert.deepEqual((await readdir(directory)).sort(), ["2026-09-30.json", "2026-10-01.json"]);
  } finally { await rm(directory, { recursive: true }); }
});

test("failed source reads leave the previous baseline intact and release the lock", async () => {
  const directory = await mkdtemp(join(tmpdir(), "daily-sanity-"));
  try {
    await saveDailyCheck(directory, async () => start, new Date(start.observedAt));
    const before = await readFile(join(directory, "2026-09-30.json"), "utf8");
    await assert.rejects(saveDailyCheck(directory, async () => { throw new Error("API unavailable"); }, new Date(end.observedAt)));
    assert.deepEqual(await readdir(directory), ["2026-09-30.json"]);
    assert.equal(await readFile(join(directory, "2026-09-30.json"), "utf8"), before);
    await saveDailyCheck(directory, async () => end, new Date(end.observedAt));
  } finally { await rm(directory, { recursive: true }); }
});

test("corrupt persisted history and stale fetched snapshots are rejected", async () => {
  const directory = await mkdtemp(join(tmpdir(), "daily-sanity-"));
  try {
    await assert.rejects(saveDailyCheck(directory, async () => start, new Date(end.observedAt)));
    await writeFile(join(directory, "2026-09-30.json"), "{broken");
    await assert.rejects(saveDailyCheck(directory, async () => end, new Date(end.observedAt)));
    await writeFile(join(directory, "2026-09-30.json"), "null");
    await assert.rejects(saveDailyCheck(directory, async () => end, new Date(end.observedAt)));
    assert.deepEqual(await readdir(directory), ["2026-09-30.json"]);
  } finally { await rm(directory, { recursive: true }); }
});

test("CLI fetches a read-only snapshot, saves the report and exits 2 for a shortfall", async () => {
  const directory = await mkdtemp(join(tmpdir(), "daily-sanity-cli-"));
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);
  const previous = { ...start, observedAt: yesterday.toISOString(), apiGeneratedAt: yesterday.toISOString() };
  const current = { ...end, observedAt: now.toISOString(), apiGeneratedAt: now.toISOString(), totalSweptRaw: start.totalSweptRaw };
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.headers.authorization !== "Bearer fixture-secret") { response.writeHead(401).end(); return; }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(current));
  });
  try {
    await saveDailyCheck(directory, async () => previous, yesterday);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await assert.rejects(promisify(execFile)(process.execPath, [fileURLToPath(new URL("../scripts/daily-sanity.mts", import.meta.url))], {
      env: { ...process.env, KEEPER_URL: `http://127.0.0.1:${address.port}`, CRON_SECRET: "fixture-secret", SANITY_DATA_DIR: directory, SANITY_TOLERANCE_BPS: "5000" },
    }), (error: unknown) => {
      const result = error as { code: number; stdout: string };
      assert.equal(result.code, 2);
      assert.equal(JSON.parse(result.stdout).status, "review");
      return true;
    });
    assert.deepEqual(requests, ["GET /api/keeper/daily-snapshot"]);
    const saved = JSON.parse(await readFile(join(directory, `${now.toISOString().slice(0, 10)}.json`), "utf8"));
    assert.equal(saved.report.collectedPumpRaw, "0");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true });
  }
});
