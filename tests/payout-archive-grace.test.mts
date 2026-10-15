import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { holdingBank } from "./support/holding-bank.mts";
import { walletTick, type WorkerOptions } from "../lib/holding/worker.ts";
import { withJournal } from "../lib/reporter/journal.ts";

for (const role of ["collector", "reviewer"] as const) {
  test(`${role} ends a missing-row wait at completed archive grace, preserves spending, and never rewinds for a late row`, async t => {
    const bank = await holdingBank(), directory = await mkdtemp(join(tmpdir(), "hold-archive-grace-"));
    t.after(() => rm(directory, {recursive: true, force: true}));
    t.mock.method(Date, "now", () => bank.time() * 1000);
    // A stub completed archive for the fixture's generating coin. Production
    // metadata provenance and first-page timing are tested in holding-feed.
    let completedHead: number | undefined;
    const options: WorkerOptions = {rpc: bank.rpc, rpcUrl: "http://127.0.0.1:1", inst: bank.inst,
      directory, role, submit: false, source: bank.source, feed: bank.feed,
      loadFeed: async () => ({...bank.feed, ...(completedHead === undefined ? {} : {
        completedArchive: {fetchedAt: new Date(completedHead * 1000).toISOString()},
      })})};
    const tick = () => walletTick(options, bank.owner, []);
    const state = () => withJournal(join(directory, "wallets"), bank.a.dividend_account,
      async journal => structuredClone(journal.state!));
    await tick(); const boundary = await state();
    const missing = bank.move("reward", 40n), received = bank.time();
    const absentRows = new Map(bank.feed.records); bank.feed.records.clear();
    assert.equal((await tick()).status, "awaiting_payout");
    bank.move("spend", 25n); bank.move("buy", 25n);
    bank.advance(received + 600 - bank.time());
    completedHead = received + 599; // wall clock alone must not release the wait.
    assert.equal((await tick()).status, "awaiting_payout");
    assert.equal((await state()).cursor, boundary.cursor);
    bank.move("reward", 7n); // This new payout DOES have exact holder attribution.
    completedHead = bank.time();
    const result = await tick();
    assert.equal(result.status, role === "collector" ? "dry_run" : "reviewed");
    const accepted = await state();
    assert.equal(accepted.eligible, "7");
    assert.equal(accepted.balance, "67"); // existing20 + excluded40 + verified7
    assert.equal(accepted.payoutWaitUntil, undefined);
    assert.equal(accepted.payoutWaitStartedAt, undefined);
    assert.notEqual(accepted.cursor, missing.transaction.signatures[0]);
    // Late attribution is not permission to reopen already committed history.
    for (const [key, row] of absentRows) bank.feed.records.set(key, row);
    bank.advance(1); completedHead = bank.time();
    await tick();
    assert.equal((await state()).eligible, "7");
    assert.equal((await state()).cursor, accepted.cursor);
    assert.equal(bank.wires.length, 0);
  });
}
