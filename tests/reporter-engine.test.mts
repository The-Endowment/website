import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWallet, type ReporterIO } from "../lib/reporter/engine.ts";
import { boundary } from "../lib/reporter/ledger.ts";
import { withJournal, type Journal } from "../lib/reporter/journal.ts";
import type { Snapshot } from "../lib/reporter/snapshot.ts";
import type { Ledger, Observation } from "../lib/reporter/types.ts";

const source = "WnhwaPaZXDTQ9GXPiZ3NwWpXVtKff15kVCWR7Arhenw";
const snapshot: Snapshot = { binding: "consent-1", slot: 11, now: 1_800_000_000, active: true, reason: "active", balance: "1100", nonce: "0", allowance: "999999", capacity: "999999", consentId: "1", collectionEpoch: "1", reporterEpoch: "1", reporter: "reporter" };
const reward: Observation = { signature: "reward", slot: 11, before: "1000", after: "1100", amount: "100", kind: "reward", reason: "matched payout" };
function memory(state: Ledger | null = boundary(snapshot.binding, 10, "start", "1000")): Journal {
  return { state, hash: "0".repeat(64), async save(next) { this.state = structuredClone(next); this.hash = "1".repeat(64); } };
}
function io(journal: Journal): ReporterIO {
  return {
    snapshot: async () => ({ ...snapshot }), cursor: async () => "reward",
    observations: async () => ({ observations: [reward], cursor: "reward" }),
    prepare: async (s, amount, hash) => ({ wire: "signed-bytes", signature: "collection", nonce: (BigInt(s.nonce) + 1n).toString(), amount: amount.toString(), lastValidBlockHeight: "200", expiresAt: s.now + 90, evidenceHash: hash }),
    status: async () => "pending", height: async () => 100n,
    publish: async () => { assert.equal(journal.state?.pending?.wire, "signed-bytes", "outbox durable before broadcast"); },
  };
}

test("first observation establishes zero eligibility; no historical backfill", async () => {
  const journal = memory(null); let prepared = false;
  const network = io(journal); network.prepare = async () => { prepared = true; throw new Error("must not sign"); };
  assert.equal((await runWallet(journal, network, true)).status, "boundary");
  assert.equal(journal.state?.eligible, "0"); assert.equal(prepared, false);
});

test("dry run records receipt evidence without loading a signer or broadcasting", async () => {
  const journal = memory(); const network = io(journal);
  network.prepare = async () => { throw new Error("must not sign"); };
  const result = await runWallet(journal, network);
  assert.deepEqual(result, { status: "dry_run", amount: "100", eligible: "100" });
  assert.equal(journal.state?.pending, null);
});

test("broadcast timeout preserves exact outbox; restart cannot sign a duplicate", async () => {
  const directory = await mkdtemp(join(tmpdir(), "reporter-outbox-"));
  try {
    await assert.rejects(withJournal(directory, source, async (journal) => {
      await journal.save(memory().state!, "initial");
      const network = io(journal); network.publish = async () => { throw new Error("timeout"); };
      await runWallet(journal, network, true);
    }), /timeout/);
    await withJournal(directory, source, async (journal) => {
      const network = io(journal); network.prepare = async () => { throw new Error("duplicate signing"); };
      assert.equal(journal.state?.pending?.signature, "collection");
      assert.equal((await runWallet(journal, network, true)).status, "pending");
      network.status = async () => "finalized";
      network.snapshot = async () => ({ ...snapshot, slot: 12, balance: "1000", nonce: "1" });
      network.observations = async () => ({ observations: [{ signature: "collection", slot: 12, before: "1100", after: "1000", amount: "100", kind: "outflow", reason: "collection" }], cursor: "collection" });
      assert.equal((await runWallet(journal, network, true)).status, "idle");
      assert.equal(journal.state?.eligible, "0"); assert.equal(journal.state?.pending, null);
    });
  } finally { await rm(directory, { recursive: true }); }
});

test("unknown transaction remains pending through last valid block, then clears without a replacement debit", async () => {
  const journal = memory(); const network = io(journal); await runWallet(journal, network, true);
  network.height = async () => 200n;
  assert.equal((await runWallet(journal, network, true)).status, "pending");
  network.height = async () => 201n;
  assert.equal((await runWallet(journal, network, true)).status, "boundary");
  assert.equal(journal.state?.eligible, "0");
});

test("pause, new consent, count epoch and reporter rotation reset pending eligibility", async () => {
  for (const patch of [{ active: false }, { binding: "new-consent" }, { binding: "new-count" }, { binding: "new-reporter" }]) {
    const journal = memory({ ...memory().state!, eligible: "50" }); const network = io(journal);
    network.snapshot = async () => ({ ...snapshot, ...patch });
    assert.equal((await runWallet(journal, network, true)).status, "boundary");
    assert.equal(journal.state?.eligible, "0");
  }
});

test("history/API failure discards uncertain eligibility rather than inferring from balance", async () => {
  const journal = memory({ ...memory().state!, eligible: "50" }); const network = io(journal);
  network.observations = async () => { throw new Error("pruned history"); };
  assert.equal((await runWallet(journal, network, true)).status, "boundary");
  assert.equal(journal.state?.eligible, "0");
});

test("same-balance spending and rebuying between reads is caught by changed transaction cursor", async () => {
  const journal = memory(); const network = io(journal); network.cursor = async () => "spend-then-rebuy";
  network.prepare = async () => { throw new Error("must not sign stale history"); };
  assert.equal((await runWallet(journal, network, true)).status, "retry");
  assert.equal(journal.state?.pending, null);
});

test("treasury capacity limits a report without adding a per-wallet daily cap", async () => {
  const journal = memory(); const network = io(journal);
  network.snapshot = async () => ({ ...snapshot, capacity: "40" });
  assert.equal((await runWallet(journal, network, true)).status, "submitted");
  assert.equal(journal.state?.pending?.amount, "40");
});

test("finalized partial collections retain their remainder and rewards received while pending", async () => {
  for (const laterReward of [0, 30]) {
    const journal = memory(); const network = io(journal);
    network.snapshot = async () => ({ ...snapshot, capacity: "40" });
    await runWallet(journal, network, true);
    const collection: Observation = { signature: "collection", slot: 12, before: "1100", after: "1060", amount: "40", kind: "outflow", reason: "collection" };
    const later: Observation = { signature: "later-reward", slot: 13, before: "1060", after: "1090", amount: "30", kind: "reward", reason: "matched payout" };
    const cursor = laterReward ? later.signature : collection.signature;
    network.status = async () => "finalized";
    network.snapshot = async () => ({ ...snapshot, slot: laterReward ? 13 : 12, balance: String(1060 + laterReward), nonce: "1" });
    network.cursor = async () => cursor;
    network.observations = async (ledger) => {
      assert.equal(ledger.pending, null);
      assert.equal(ledger.cursor, "reward", "replay starts before the collection");
      return { observations: laterReward ? [collection, later] : [collection], cursor };
    };
    const expected = String(60 + laterReward);
    assert.deepEqual(await runWallet(journal, network), { status: "dry_run", amount: expected, eligible: expected });
    assert.equal(journal.state?.settled, undefined);
    network.observations = async (ledger) => {
      assert.equal(ledger.cursor, cursor);
      return { observations: [], cursor };
    };
    assert.deepEqual(await runWallet(journal, network), { status: "dry_run", amount: expected, eligible: expected }, "collection is deducted exactly once");
  }
});

test("a known failed collection preserves eligibility and later rewards", async () => {
  const journal = memory(); const network = io(journal);
  await runWallet(journal, network, true);
  network.status = async () => "failed";
  network.snapshot = async () => ({ ...snapshot, slot: 13, balance: "1130" });
  network.cursor = async () => "later-reward";
  network.observations = async () => ({ cursor: "later-reward", observations: [
    { signature: "collection", slot: 12, before: "1100", after: "1100", amount: "0", kind: "failed", reason: "failed collection" },
    { signature: "later-reward", slot: 13, before: "1100", after: "1130", amount: "30", kind: "reward", reason: "matched payout" },
  ] });
  assert.deepEqual(await runWallet(journal, network), { status: "dry_run", amount: "130", eligible: "130" });
  assert.equal(journal.state?.pending, null);
});

test("known success waits for a finalized bank that includes its consumed nonce", async () => {
  const journal = memory(); const network = io(journal);
  await runWallet(journal, network, true);
  network.status = async () => "finalized";
  network.prepare = async () => { throw new Error("must not reuse consumed nonce"); };
  assert.deepEqual(await runWallet(journal, network, true), { status: "pending", signature: "collection" });
  assert.equal(journal.state?.pending?.nonce, "1");
});

test("restart after clearing a known submission replays history once and never reuses its nonce", async () => {
  const directory = await mkdtemp(join(tmpdir(), "reporter-settled-"));
  const collected = { ...snapshot, slot: 12, balance: "1060", nonce: "1" };
  const collection: Observation = { signature: "collection", slot: 12, before: "1100", after: "1060", amount: "40", kind: "outflow", reason: "collection" };
  try {
    await withJournal(directory, source, async (journal) => {
      await journal.save(memory().state!, "initial");
      const network = io(journal);
      network.snapshot = async () => ({ ...snapshot, capacity: "40" });
      await runWallet(journal, network, true);
    });
    await assert.rejects(withJournal(directory, source, async (journal) => {
      const network = io(journal);
      network.snapshot = async () => collected;
      network.status = async () => "finalized";
      const save = journal.save;
      journal.save = async (next, reason, evidence) => {
        await save(next, reason, evidence);
        if (next.settled) throw new Error("crash after durable clear");
      };
      await runWallet(journal, network, true);
    }), /crash after durable clear/);
    await withJournal(directory, source, async (journal) => {
      assert.equal(journal.state?.pending, null);
      assert.equal(journal.state?.eligible, "100");
      assert.equal(journal.state?.cursor, "reward");
      assert.deepEqual(journal.state?.settled, { slot: 12, nonce: "1" });
      const network = io(journal);
      network.snapshot = async (minimum) => { assert.equal(minimum, 12); return { ...snapshot }; };
      network.prepare = async () => { throw new Error("must not reuse consumed nonce"); };
      assert.equal((await runWallet(journal, network, true)).status, "retry");
    });
    await withJournal(directory, source, async (journal) => {
      const network = io(journal);
      network.snapshot = async (minimum) => { assert.equal(minimum, 12); return collected; };
      network.cursor = async () => "collection";
      network.observations = async (ledger) => {
        assert.equal(ledger.cursor, "reward");
        return { observations: [collection], cursor: "collection" };
      };
      const prepare = network.prepare;
      network.prepare = async (...args) => ({ ...await prepare(...args), signature: "collection-2" });
      assert.deepEqual(await runWallet(journal, network, true), { status: "submitted", signature: "collection-2", amount: "60" });
      assert.equal(journal.state?.eligible, "60");
      assert.equal(journal.state?.settled, undefined);
      assert.equal(journal.state?.pending?.nonce, "2");
    });
    await withJournal(directory, source, async (journal) => {
      const network = io(journal);
      network.snapshot = async () => collected;
      network.prepare = async () => { throw new Error("duplicate signing"); };
      assert.equal((await runWallet(journal, network, true)).status, "pending");
      assert.equal(journal.state?.pending?.nonce, "2");
    });
  } finally { await rm(directory, { recursive: true }); }
});

test("journal lock and truncated records stop signing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "reporter-corrupt-"));
  try {
    await withJournal(directory, source, async (journal) => {
      await journal.save(memory().state!, "initial");
      await assert.rejects(withJournal(directory, source, async () => {}), /EEXIST/);
    });
    const contents = await readFile(join(directory, `${source}.jsonl`), "utf8");
    assert.match(contents, /initial/);
    await appendFile(join(directory, `${source}.jsonl`), '{"partial":');
    await assert.rejects(withJournal(directory, source, async () => {}), /Truncated/);
  } finally { await rm(directory, { recursive: true }); }
});
