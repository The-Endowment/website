import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PUMP_MINT } from "../lib/endowment.ts";
import { archiveFeed } from "../lib/holding/feed.ts";
import { PAYOUT_URL, type Payout } from "../lib/holding/payout-history.ts";
import { verifyRecovery } from "../lib/holding/recovery.ts";

const start = Date.parse("2026-10-09T12:00:00.000Z"), floor = new Date(start - 60000).toISOString();
const row = (letter: string, extra: Partial<Payout> = {}): Payout => ({ signature: letter.repeat(64),
  holder: "H".repeat(32), assetMint: PUMP_MINT, amountRaw: "10", createdAt: new Date(start - 5000).toISOString(), ...extra });
const below = (letter: string) => row(letter, { createdAt: new Date(start - 120000).toISOString() });
const page = (rows: Payout[], nextCursor: string | null = null) => ({ rows, page: { limit: 100, order: "desc", nextCursor } });

async function rebuild(rows: Payout[]) {
  const dir = await mkdtemp(join(tmpdir(), "recovery-"));
  try {
    await archiveFeed(dir, { historyFloor: floor, now: () => start, request: (async () =>
      Response.json(page(rows, "older"), { headers: { date: new Date(start).toUTCString() } })) as typeof fetch });
    return JSON.parse(await readFile(join(dir, "payout-feed.json"), "utf8"));
  } finally { await rm(dir, { recursive: true, force: true }); }
}
// Old archive with a below-floor transaction cut short; unfinished scan with newer rows.
const oldArchive = { historyFloor: floor, rows: [row("A"), below("X")] };
const oldPending = { version: 1, source: PAYOUT_URL, historyFloor: floor, rows: [row("N"), row("M"), row("A")] };

test("recovery passes when every post-floor row of the old archive and unfinished scan is present unchanged", async () => {
  const result = verifyRecovery(await rebuild([row("N"), row("M"), row("A"), below("X")]),
    [{ name: "archive", value: oldArchive }, { name: "pending", value: oldPending }], "2026-10-09T11:59:00Z");
  assert.equal(result.ok, true, result.problems.join("; "));
  assert.equal(result.floor, floor);
  assert.deepEqual(result.checked.pending, { rows: 3, atOrAfterFloor: 3, missing: 0, changed: 0 });
  assert.deepEqual(result.checked.archive, { rows: 2, atOrAfterFloor: 1, missing: 0, changed: 0 });
});

test("recovery fails on a missing pending row, a changed amount, or a different floor", async () => {
  const missing = verifyRecovery(await rebuild([row("A"), below("X")]),
    [{ name: "pending", value: oldPending }], floor);
  assert.deepEqual(missing.problems, ["pending: 2 rows missing, 0 changed"]);
  const changed = verifyRecovery(await rebuild([row("N"), row("M", { amountRaw: "11" }), row("A"), below("X")]),
    [{ name: "pending", value: oldPending }], floor);
  assert.deepEqual(changed.problems, ["pending: 0 rows missing, 1 changed"]);
  const rebuilt = await rebuild([row("N"), row("M"), row("A"), below("X")]);
  const moved = verifyRecovery(rebuilt, [{ name: "archive", value: { ...oldArchive, historyFloor: undefined } }], floor);
  assert.equal(moved.ok, false);
  assert.match(moved.problems[0], /archive floor is missing/);
  const otherFloor = verifyRecovery(rebuilt, [{ name: "archive", value: oldArchive }], new Date(start - 30000).toISOString());
  assert.equal(otherFloor.ok, false);
  assert.match(otherFloor.problems[0], /rebuilt floor is/);
});
