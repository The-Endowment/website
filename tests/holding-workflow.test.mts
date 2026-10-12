import assert from "node:assert/strict";
import { test } from "node:test";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddressDecoder } from "@solana/kit";
import { holdingBank } from "./support/holding-bank.mts";
import { walletTick, type WorkerOptions } from "../lib/holding/worker.ts";
import { withJournal } from "../lib/reporter/journal.ts";
import type { ReviewedLedger } from "../lib/holding/reconcile.ts";

// Public, deterministic test keys, generated locally; no wallet or network secrets.
async function testKey(directory: string, name: string, byte: number) {
  const seed = Buffer.alloc(32, byte);
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(-32);
  const path = join(directory, `${name}.keypair.json`);
  await writeFile(path, JSON.stringify([...seed, ...publicKey]), { mode: 0o600 });
  return { path, address: getAddressDecoder().decode(publicKey) };
}

test("collector → held receipt → independent partial review → refund protection → future payout", async (t) => {
  const bank = await holdingBank(), directory = await mkdtemp(join(tmpdir(), "hold-workflow-"));
  t.mock.method(Date, "now", () => bank.time() * 1000);
  const server = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    assert.equal(request.method, "getLatestBlockhash");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { context: { slot: 100 }, value: {
      blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1000,
    } } }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const collector = await testKey(directory, "collector", 91), reviewer = await testKey(directory, "reviewer", 92);
    bank.policy.collector = collector.address; bank.policy.reviewer = reviewer.address;
    const rpcUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const options = (role: "collector" | "reviewer", submit = true): WorkerOptions => ({
      rpc: bank.rpc, rpcUrl, inst: bank.inst, directory: join(directory, role), submit, role,
      keyFile: role === "collector" ? collector.path : reviewer.path, source: bank.source, feed: bank.feed,
    });
    const tick = (role: "collector" | "reviewer", submit = true, receipts = bank.receipts()) => walletTick(options(role, submit), bank.owner, receipts);
    assert.equal((await tick("collector", false, [])).status, "boundary");
    await tick("reviewer", false, []);
    bank.move("reward", 40n);
    const collected = await tick("collector", true, []);
    assert.equal(collected.status, "submitted");
    assert.equal("amount" in collected && collected.amount, "40");
    assert.equal(bank.wires.length, 1);
    // The expected-balance guard cannot detect an intervening spend/rebuy of equal size.
    bank.move("spend", 25n); bank.move("buy", 25n); bank.move("sweep", 40n);
    const waiting = await tick("reviewer");
    assert.equal("outcomes" in waiting && waiting.outcomes[0].action, "wait");
    await withJournal(join(directory, "reviewer", "wallets"), bank.a.dividend_account, async j => {
      assert.equal((j.state as ReviewedLedger).reviews![bank.receiptKey].amount, "15");
    });
    bank.advance(86400);
    const cleared = await tick("reviewer");
    assert.equal("outcomes" in cleared && cleared.outcomes[0].action, "clear");
    assert.equal(bank.wires.length, 2);
    assert.ok(bank.wires.every(w => Buffer.from(w, "base64").length <= 1232));
    // Apply the partial-refund result already exercised by Rust's settlement tests.
    bank.policy.pending = 0n; bank.policy.released += 15n; bank.policy.refunded += 25n;
    bank.landlord.baseline += 25n; bank.move("refund", 25n);
    assert.equal(bank.consent.enabled, true);
    await tick("collector", false, []); // recover the original durable submission
    assert.equal((await tick("collector", false, [])).status, "idle");
    bank.move("reward", 10n);
    const next = await tick("collector", false, []);
    assert.equal(next.status, "dry_run");
    assert.equal("amount" in next && next.amount, "10");
  } finally {
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    await rm(directory, { recursive: true });
  }
});

test("a completed review without payout evidence refunds immediately, even when the pool is unavailable", async (t) => {
  const bank = await holdingBank(), directory = await mkdtemp(join(tmpdir(), "hold-missing-evidence-"));
  t.mock.method(Date, "now", () => bank.time() * 1000);
  const options: WorkerOptions = { rpc: bank.rpc, rpcUrl: "http://127.0.0.1", inst: bank.inst,
    directory, submit: false, role: "reviewer", source: bank.source, feed: new Map() };
  try {
    await walletTick(options, bank.owner, []);
    bank.move("reward", 40n); bank.move("sweep", 40n);
    const rejected = await walletTick(options, bank.owner, bank.receipts());
    assert.equal("outcomes" in rejected && rejected.outcomes[0].action, "refund");
    bank.advance(86400); bank.removePool();
    const result = await walletTick(options, bank.owner, bank.receipts());
    assert.equal("outcomes" in result && result.outcomes[0].action, "refund");
    assert.equal(bank.wires.length, 0);
  } finally { await rm(directory, { recursive: true }); }
});

for (const failure of ["stale archive", "conflicting archive"] as const) {
  test(`a prior positive review cannot release with a ${failure}; refunds remain available`, async (t) => {
    const bank = await holdingBank(), directory = await mkdtemp(join(tmpdir(), "hold-feed-release-"));
    t.mock.method(Date, "now", () => bank.time() * 1000);
    let signingRequests = 0, releaseChecks = 0;
    const server = createServer(async (req, res) => {
      let body = ""; for await (const chunk of req) body += chunk;
      const request = JSON.parse(body);
      assert.equal(request.method, "getLatestBlockhash"); signingRequests++;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { context: { slot: 100 }, value: {
        blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1000,
      } } }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const reviewer = await testKey(directory, "reviewer", 92);
      bank.policy.reviewer = reviewer.address;
      const options: WorkerOptions = { rpc: bank.rpc,
        rpcUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, inst: bank.inst,
        directory, submit: false, role: "reviewer", keyFile: reviewer.path, source: bank.source, feed: bank.feed };
      await walletTick(options, bank.owner, []);
      bank.move("reward", 40n); bank.move("sweep", 40n);
      await walletTick(options, bank.owner, bank.receipts());
      await withJournal(join(directory, "wallets"), bank.a.dividend_account, async journal => {
        assert.equal((journal.state as ReviewedLedger).reviews![bank.receiptKey].amount, "40");
      });
      bank.advance(86400);
      // The production reviewer uses an empty feed on an archive failure so it
      // can still process recovery. Old positive decisions need a separate gate.
      options.submit = true; options.loadFeed = async () => new Map();
      options.beforeRelease = async () => { releaseChecks++; throw new Error(failure); };
      const blocked = await walletTick(options, bank.owner, bank.receipts());
      assert.equal("outcomes" in blocked && blocked.outcomes[0].result, "blocked");
      assert.equal(releaseChecks, 1); assert.equal(signingRequests, 0); assert.equal(bank.wires.length, 0);
      await withJournal(join(directory, "settlements"), bank.receiptKey, async journal => {
        assert.equal(journal.state, null);
      });
      bank.consent.enabled = false;
      const refunded = await walletTick(options, bank.owner, bank.receipts());
      assert.equal("outcomes" in refunded && refunded.outcomes[0].action, "refund");
      assert.equal("outcomes" in refunded && refunded.outcomes[0].result, "submitted");
      assert.equal(releaseChecks, 1); assert.equal(signingRequests, 1); assert.equal(bank.wires.length, 1);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
      await rm(directory, { recursive: true });
    }
  });
}

test("feed failure before release broadcast preserves its outbox and reconciles without re-signing", async (t) => {
  const bank = await holdingBank(), directory = await mkdtemp(join(tmpdir(), "hold-feed-broadcast-"));
  t.mock.method(Date, "now", () => bank.time() * 1000);
  let signingRequests = 0, releaseChecks = 0, height = 999;
  const server = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    assert.equal(request.method, "getLatestBlockhash"); signingRequests++;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { context: { slot: 100 }, value: {
      blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1000,
    } } }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const reviewer = await testKey(directory, "reviewer", 92);
    bank.policy.reviewer = reviewer.address;
    const rpc: WorkerOptions["rpc"] = async <T,>(method: string, params: unknown[]) => {
      if (method === "getSignatureStatuses") return { value: [null] } as T;
      if (method === "getBlockHeight") return height as T;
      return bank.rpc<T>(method, params);
    };
    const options: WorkerOptions = { rpc,
      rpcUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, inst: bank.inst,
      directory, submit: false, role: "reviewer", keyFile: reviewer.path, source: bank.source, feed: bank.feed };
    await walletTick(options, bank.owner, []);
    bank.move("reward", 40n); bank.move("sweep", 40n);
    await walletTick(options, bank.owner, bank.receipts());
    bank.advance(86400); options.submit = true;
    options.beforeRelease = async () => {
      if (++releaseChecks > 1) throw new Error("Capture invalidated after signing");
    };
    const tick = () => walletTick(options, bank.owner, bank.receipts());
    const blocked = await tick();
    assert.equal("outcomes" in blocked && blocked.outcomes[0].result, "blocked");
    assert.equal(releaseChecks, 2); assert.equal(signingRequests, 1); assert.equal(bank.wires.length, 0);
    let signature: string | undefined;
    await withJournal(join(directory, "settlements"), bank.receiptKey, async journal => {
      signature = journal.state?.pending?.signature; assert.ok(signature);
    });
    const waiting = await tick();
    assert.equal("outcomes" in waiting && waiting.outcomes[0].result, "pending");
    assert.equal(releaseChecks, 2); assert.equal(signingRequests, 1);
    await withJournal(join(directory, "settlements"), bank.receiptKey, async journal => {
      assert.equal(journal.state?.pending?.signature, signature);
    });
    height = 1001;
    const recovered = await tick();
    assert.equal("outcomes" in recovered && recovered.outcomes[0].result, "reconciled");
    assert.equal(releaseChecks, 2); assert.equal(signingRequests, 1); assert.equal(bank.wires.length, 0);
    // Only after the old transaction expires may a new action be prepared.
    // The feed remains invalid, so a new clear is still refused.
    const stillBlocked = await tick();
    assert.equal("outcomes" in stillBlocked && stillBlocked.outcomes[0].result, "blocked");
    assert.equal(releaseChecks, 3); assert.equal(signingRequests, 1); assert.equal(bank.wires.length, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    await rm(directory, { recursive: true });
  }
});

for (const role of ["collector", "reviewer"] as const) {
  test(`${role} reloads captured payouts after wallet history instead of using the pass's original feed`, async (t) => {
    const bank = await holdingBank(), directory = await mkdtemp(join(tmpdir(), "hold-reload-feed-"));
    t.mock.method(Date, "now", () => bank.time() * 1000);
    const calls: string[] = [];
    const rpc: WorkerOptions["rpc"] = async <T,>(method: string, params: unknown[]) => {
      const result = await bank.rpc<T>(method, params);
      calls.push(method);
      return result;
    };
    const options: WorkerOptions = { rpc, rpcUrl: "http://127.0.0.1", inst: bank.inst,
      directory, submit: false, role, source: bank.source, feed: new Map(),
      loadFeed: async () => {
        // This is the independent capture's newer snapshot, made available
        // while the worker was still reading finalized wallet transactions.
        assert.equal(calls.at(-1), "getTransaction");
        assert.equal(calls.filter(method => method === "getTransaction").length,
          role === "collector" ? 1 : 2);
        calls.push("loadFeed");
        return new Map(bank.feed);
      },
    };
    try {
      assert.equal((await walletTick(options, bank.owner, [])).status,
        role === "collector" ? "boundary" : "reviewed");
      calls.length = 0;
      bank.move("reward", 40n);
      if (role === "reviewer") bank.move("sweep", 40n);
      const result = await walletTick(options, bank.owner, role === "reviewer" ? bank.receipts() : []);
      assert.equal(options.feed.size, 0);
      assert.equal(calls.filter(method => method === "loadFeed").length, 1);
      if (role === "collector") {
        assert.equal(result.status, "dry_run");
        assert.equal("amount" in result && result.amount, "40");
      } else {
        assert.equal("outcomes" in result && result.outcomes[0].action, "wait");
        await withJournal(join(directory, "wallets"), bank.a.dividend_account, async journal => {
          assert.equal((journal.state as ReviewedLedger).reviews![bank.receiptKey].amount, "40");
        });
      }
      assert.equal(bank.wires.length, 0);
    } finally { await rm(directory, { recursive: true }); }
  });
}

for (const scenario of ["before hold", "after hold", "during pause", "deregistered"] as const) {
  test(`pruned landlord refunds a positively reviewed contribution: ${scenario}`, async (t) => {
    const bank = await holdingBank(), directory = await mkdtemp(join(tmpdir(), "hold-pruned-"));
    t.mock.method(Date, "now", () => bank.time() * 1000);
    const options: WorkerOptions = { rpc: bank.rpc, rpcUrl: "http://127.0.0.1", inst: bank.inst,
      directory, submit: false, role: "reviewer", source: bank.source, feed: bank.feed };
    const tick = () => walletTick(options, bank.owner, bank.receipts());
    const assertPositiveReview = () => withJournal(join(directory, "wallets"), bank.a.dividend_account, async j => {
      assert.equal((j.state as ReviewedLedger).reviews![bank.receiptKey].amount, "40");
    });
    try {
      await walletTick(options, bank.owner, []);
      bank.move("reward", 40n); bank.move("sweep", 40n);
      const first = await tick();
      assert.equal("outcomes" in first && first.outcomes[0].action, "wait");
      await assertPositiveReview();
      if (scenario === "after hold" || scenario === "during pause") bank.advance(86400);
      if (scenario === "during pause") {
        bank.config.pause_started_at = BigInt(bank.time());
        bank.config.paused_until = BigInt(bank.time() + 86400);
      }
      // Incident receipts are refundable immediately; ordinary holds still wait.
      const registered = await tick();
      assert.equal("outcomes" in registered && registered.outcomes[0].action,
        scenario === "after hold" ? "clear" : scenario === "during pause" ? "refund" : "wait");
      bank.removeLandlord();
      if (scenario === "deregistered") bank.consent.enabled = false;
      const pruned = await tick();
      assert.equal("outcomes" in pruned && pruned.outcomes[0].action, "refund");
      assert.equal(bank.consent.enabled, scenario !== "deregistered");
      // The positive decision survived the reset; lack of enrollment itself
      // must override it, instead of waiting for evidence/consent to disappear.
      await assertPositiveReview();
      assert.equal(bank.wires.length, 0);
    } finally { await rm(directory, { recursive: true }); }
  });
}
