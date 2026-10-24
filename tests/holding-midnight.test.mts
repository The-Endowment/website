import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { holdingBank } from "./support/holding-bank.mts";
import { walletTick, type WorkerOptions } from "../lib/holding/worker.ts";
import { withJournal } from "../lib/reporter/journal.ts";
import type { ReviewedLedger } from "../lib/holding/reconcile.ts";
import { PassHealth } from "../lib/holding/operations-health.ts";

async function scenario(t: TestContext) {
  const bank = await holdingBank(), directory = await mkdtemp(join(tmpdir(), "hold-midnight-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  // Thirty seconds before midnight, with a current finalized count.
  bank.advance(86400 - bank.time() % 86400 - 30);
  bank.config.last_count_at = BigInt(bank.time());
  t.mock.method(Date, "now", () => bank.time() * 1000);
  const options = (role: "collector" | "reviewer"): WorkerOptions => ({
    rpc: bank.rpc, rpcUrl: "http://127.0.0.1:1", inst: bank.inst, directory: join(directory, role),
    role, submit: false, source: bank.source, feed: bank.feed,
  });
  const tick = (role: "collector" | "reviewer", receipts = false, extra: Partial<WorkerOptions> = {}) =>
    walletTick({...options(role), ...extra}, bank.owner, receipts ? bank.receipts() : []);
  const both = async (receipts = false) => [await tick("collector"), await tick("reviewer", receipts)];
  const state = (role: "collector" | "reviewer") => withJournal(join(directory, role, "wallets"),
    bank.a.dividend_account, async journal => structuredClone(journal.state) as ReviewedLedger);
  const logs = (role: "collector" | "reviewer") => readFile(join(directory, role, "wallets", bank.a.dividend_account + ".jsonl"), "utf8");
  await both();
  return {bank, directory, tick, both, state, logs};
}

test("both journals retain only waiting payouts across midnight and a count, replay spending, and never double count", async t => {
  const s = await scenario(t), {bank} = s;
  bank.move("reward", 10n); await s.both(); // Already verified: must be discarded.
  bank.move("reward", 8n); // Present evidence but held by the later missing rows: also not carried.
  const present = new Map(bank.feed.records);
  bank.move("reward", 30n); bank.move("reward", 12n);
  const all = new Map(bank.feed.records);
  bank.feed.records.clear(); for (const [k, v] of present) bank.feed.records.set(k, v);
  for (const r of await s.both()) assert.equal(r.status, "awaiting_payout");
  const old = await s.state("collector");
  bank.move("spend", 10n); bank.move("buy", 10n); bank.move("refund", 3n);
  bank.advance(86400 - bank.time() % 86400 + 1);
  for (const r of await s.both()) assert.equal(r.status, "awaiting_payout");
  bank.advance(2); bank.config.last_count_at = BigInt(bank.time());
  for (const r of await s.both()) assert.equal(r.status, "awaiting_payout");
  for (const role of ["collector", "reviewer"] as const) {
    const waiting = await s.state(role);
    assert.equal(waiting.version, 2, "Old workers must reject selective carry instead of replaying all old rewards");
    assert.equal(waiting.eligible, "0"); assert.equal(waiting.cursor, old.cursor);
    assert.equal(waiting.payoutWaitUntil, old.payoutWaitUntil);
    assert.equal(waiting.payoutWaitStartedAt, old.payoutWaitStartedAt);
    assert.match(await s.logs(role), /New UTC day or count: uncollected eligibility cleared, no tokens moved/);
  }
  for (const [k, v] of all) bank.feed.records.set(k, v);
  await s.both();
  for (const role of ["collector", "reviewer"] as const) {
    assert.equal((await s.state(role)).eligible, "32");
    assert.equal((await s.state(role)).payoutWaitUntil, undefined);
  }
  await s.both();
  for (const role of ["collector", "reviewer"] as const) assert.equal((await s.state(role)).eligible, "32");
  assert.equal(bank.wires.length, 0);
});

test("evidence that appears on the first post-midnight read survives; new verified payouts remain eligible", async t => {
  const s = await scenario(t), {bank} = s;
  bank.move("reward", 20n); const rows = new Map(bank.feed.records); bank.feed.records.clear();
  await s.both();
  bank.advance(40); for (const [k, v] of rows) bank.feed.records.set(k, v);
  bank.move("reward", 7n);
  await s.both();
  for (const role of ["collector", "reviewer"] as const) assert.equal((await s.state(role)).eligible, "27");
});

test("ordinary daily reset still discards verified eligibility and explains that no tokens moved", async t => {
  const s = await scenario(t), {bank} = s;
  bank.move("reward", 20n); await s.both(); bank.advance(40); await s.both();
  for (const role of ["collector", "reviewer"] as const) {
    assert.equal((await s.state(role)).eligible, "0"); assert.equal((await s.state(role)).balance, "40");
    assert.match(await s.logs(role), /New UTC day or count: uncollected eligibility cleared, no tokens moved/);
  }
});

test("midnight never extends the evidence deadline or hides an expired attribution", async t => {
  const s = await scenario(t), {bank} = s;
  bank.move("reward", 20n); bank.feed.records.clear(); await s.both();
  const deadline = (await s.state("collector")).payoutWaitUntil!;
  bank.advance(deadline - bank.time());
  for (const role of ["collector", "reviewer"] as const) {
    const health = new PassHealth(role, false);
    const result = await s.tick(role, false, {observe: event => health.observe(bank.owner, event)});
    health.outcome(result);
    assert.ok(health.issues.has("payout_evidence_expired"));
    assert.equal((await s.state(role)).eligible, "0");
    assert.equal((await s.state(role)).payoutWaitUntil, undefined);
  }
});

test("a delayed payout cannot revive consent or cross changed roles, refresher or pause at midnight", async t => {
  const changes = [
    (b: Awaited<ReturnType<typeof holdingBank>>) => { b.consent.epoch++; },
    (b: Awaited<ReturnType<typeof holdingBank>>) => { b.consent.enabled = false; },
    (b: Awaited<ReturnType<typeof holdingBank>>) => { b.policy.collector = b.owner; },
    (b: Awaited<ReturnType<typeof holdingBank>>) => { b.policy.reviewer = b.owner; },
    (b: Awaited<ReturnType<typeof holdingBank>>) => { b.config.refresher_epoch++; },
    (b: Awaited<ReturnType<typeof holdingBank>>) => { b.config.paused_until = BigInt(b.time() + 60); b.config.pause_started_at = BigInt(b.time()); },
  ];
  for (const change of changes) {
    const s = await scenario(t), {bank} = s;
    bank.move("reward", 20n); const rows = new Map(bank.feed.records); bank.feed.records.clear(); await s.both();
    bank.advance(40); change(bank); for (const [k, v] of rows) bank.feed.records.set(k, v);
    await s.both();
    for (const role of ["collector", "reviewer"] as const) assert.equal((await s.state(role)).eligible, "0");
    assert.equal(bank.wires.length, 0); t.mock.restoreAll();
  }
});

test("reviewer retains delayed evidence across midnight for a partial refund decision", async t => {
  const s = await scenario(t), {bank} = s;
  bank.move("reward", 40n); const rows = new Map(bank.feed.records); bank.feed.records.clear();
  await s.both();
  bank.move("spend", 25n); bank.move("buy", 25n); bank.move("sweep", 40n);
  bank.advance(40);
  const waiting = await s.tick("reviewer", true);
  assert.equal(waiting.status, "awaiting_payout");
  assert.equal("outcomes" in waiting && waiting.outcomes[0].action, "wait");
  for (const [k, v] of rows) bank.feed.records.set(k, v);
  await s.tick("reviewer", true);
  assert.equal((await s.state("reviewer")).reviews![bank.receiptKey].amount, "15");
  assert.equal((await s.state("reviewer")).eligible, "0");
  bank.advance(86400);
  const cleared = await s.tick("reviewer", true);
  assert.equal("outcomes" in cleared && cleared.outcomes[0].action, "clear");
  assert.equal(bank.wires.length, 0);
});

test("midnight carry still stops on incomplete history and unexplained transactions", async t => {
  for (const failure of ["gap", "uncertain"] as const) {
    const s = await scenario(t), {bank} = s;
    const tx = bank.move("reward", 20n); const rows = new Map(bank.feed.records); bank.feed.records.clear(); await s.both();
    bank.advance(40); for (const [k, v] of rows) bank.feed.records.set(k, v);
    if (failure === "uncertain") tx.meta = null;
    for (const role of ["collector", "reviewer"] as const) {
      const health = new PassHealth(role, false);
      const rpc: WorkerOptions["rpc"] = async <T,>(method: string, params: unknown[]) => {
        if (failure === "gap" && method === "getTransaction") return null as T;
        return bank.rpc<T>(method, params);
      };
      try { health.outcome(await s.tick(role, false, {rpc, observe: event => health.observe(bank.owner, event)})); }
      catch { health.failure(); }
      assert.ok(health.historyStop() || health.failures > 0);
      assert.equal((await s.state(role)).eligible, "0");
    }
    assert.equal(bank.wires.length, 0); t.mock.restoreAll();
  }
});

test("an unobserved payout and old journals without continuity evidence cannot gain retroactive eligibility", async t => {
  for (const legacy of [false, true]) {
    const s = await scenario(t), {bank} = s;
    bank.move("reward", 20n); const rows = new Map(bank.feed.records); bank.feed.records.clear();
    if (legacy) {
      await s.both();
      for (const role of ["collector", "reviewer"] as const)
        await withJournal(join(s.directory, role, "wallets"), bank.a.dividend_account, async journal => {
          const old = {...journal.state!}; delete old.payoutBoundary; delete old.payoutWaitSignatures;
          await journal.save(old, "Existing journal from before continuity tracking");
        });
    }
    bank.advance(40); for (const [k, v] of rows) bank.feed.records.set(k, v); await s.both();
    for (const role of ["collector", "reviewer"] as const) assert.equal((await s.state(role)).eligible, "0");
    t.mock.restoreAll();
  }
});

test("a receipt first discovered after rollover cannot join old carry, and same-second count ordering stays conservative", async t => {
  const s = await scenario(t), {bank} = s;
  bank.move("reward", 20n); const waiting = new Map(bank.feed.records); bank.feed.records.clear(); await s.both();
  // This second old receipt was never recorded as waiting before midnight.
  bank.move("reward", 9n); const discovered = new Map(bank.feed.records); bank.feed.records.clear();
  bank.advance(40); await s.both();
  // The previous wait remains; a new count cannot bless a reward with ambiguous same-second ordering.
  const sameSecond = bank.move("reward", 5n); bank.config.last_count_at = BigInt(sameSecond.blockTime!);
  const sameSecondRows = new Map(bank.feed.records);
  await s.both();
  for (const group of [waiting, discovered, sameSecondRows]) for (const [k, v] of group) bank.feed.records.set(k, v);
  await s.both();
  for (const role of ["collector", "reviewer"] as const) assert.equal((await s.state(role)).eligible, "20");
});

test("reviewer can plan owner-revoked refunds while midnight payout evidence is still missing", async t => {
  const s = await scenario(t), {bank} = s;
  bank.move("reward", 20n); bank.feed.records.clear(); await s.both();
  bank.move("sweep", 20n); bank.advance(40); await s.tick("reviewer", true);
  bank.consent.enabled = false;
  const stopped = await s.tick("reviewer", true);
  assert.equal(stopped.status, "awaiting_payout");
  assert.equal("outcomes" in stopped && stopped.outcomes[0].action, "refund");
  assert.equal(bank.wires.length, 0);
});


test("completed receipt decisions survive a later midnight attribution wait", async t => {
  const s = await scenario(t), {bank} = s;
  bank.move("reward", 15n); bank.move("sweep", 15n); await s.tick("reviewer", true);
  const reviewed = (await s.state("reviewer")).reviews![bank.receiptKey];
  assert.equal(reviewed.amount, "15");
  bank.move("reward", 8n); const all = new Map(bank.feed.records); bank.feed.records.clear();
  await s.tick("reviewer", true); bank.advance(40); await s.tick("reviewer", true);
  assert.deepEqual((await s.state("reviewer")).reviews![bank.receiptKey], reviewed);
  for (const [k, v] of all) bank.feed.records.set(k, v); await s.tick("reviewer", true);
  assert.deepEqual((await s.state("reviewer")).reviews![bank.receiptKey], reviewed);
  assert.equal((await s.state("reviewer")).eligible, "8");
});

test("corrupt waiting receipt identities or boundary metadata fail closed when saving the journal", async t => {
  const s = await scenario(t), {bank} = s;
  bank.move("reward", 10n); bank.feed.records.clear(); await s.both();
  await withJournal(join(s.directory, "collector", "wallets"), bank.a.dividend_account, async journal => {
    const waiting = journal.state!;
    for (const patch of [
      {payoutWaitSignatures: ["duplicate", "duplicate"]}, {payoutWaitSignatures: [""]},
      {payoutWaitSignatures: ["a".repeat(129)]}, {payoutWaitUntil: undefined},
      {payoutBoundary: {scope: "", at: bank.time()}},
      {payoutBoundary: {scope: "scope", at: -1}},
      {payoutCarryAfter: NaN}, {payoutCarryAfter: 1.5},
      {version: 1 as const, payoutCarryAfter: bank.time()},
      {payoutCarryAfter: bank.time(), payoutBoundary: undefined},
    ]) await assert.rejects(journal.save({...waiting, ...patch}, "Invalid metadata"), /Invalid payout|Invalid waiting/);
    assert.deepEqual(journal.state, waiting);
  });
});

test("reviewer remembers an incident during its evidence wait even if the old settings return before midnight", async t => {
  for (const incident of ["collector", "inactive"] as const) {
    const s = await scenario(t), {bank} = s;
    bank.move("reward", 20n); const rows = new Map(bank.feed.records); bank.feed.records.clear();
    await s.tick("reviewer");
    const originalCollector = bank.policy.collector;
    if (incident === "collector") bank.policy.collector = bank.owner;
    else bank.config.active = false;
    assert.equal((await s.tick("reviewer")).status, "awaiting_payout");
    assert.equal((await s.state("reviewer")).payoutCarryBlocked, true);
    bank.policy.collector = originalCollector; bank.config.active = true;
    bank.advance(40); for (const [k, v] of rows) bank.feed.records.set(k, v);
    await s.tick("reviewer");
    assert.equal((await s.state("reviewer")).eligible, "0");
    assert.equal(bank.wires.length, 0); t.mock.restoreAll();
  }
});
