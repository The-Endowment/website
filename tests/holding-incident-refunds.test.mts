import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getAddressDecoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";
import { holdingBank } from "./support/holding-bank.mts";
import { walletTick, type WorkerOptions } from "../lib/holding/worker.ts";
import { settlementPlan, type ReviewedLedger } from "../lib/holding/reconcile.ts";
import { holdSnapshot } from "../lib/holding/snapshot.ts";
import { withJournal } from "../lib/reporter/journal.ts";
import type { RpcCall } from "../lib/reporter/rpc.ts";
import { schema } from "../lib/holding/codec.ts";

const PAUSED = (1n << 63n) - 1n;

async function scenario(t: TestContext) {
  const bank = await holdingBank();
  const directory = await mkdtemp(join(tmpdir(), "hold-incident-"));
  t.mock.method(Date, "now", () => bank.time() * 1000);
  // Deterministic public test key. No production credentials or external RPC.
  const seed = Buffer.alloc(32, 93);
  const secret = createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
    format: "der", type: "pkcs8",
  });
  const publicKey = createPublicKey(secret).export({ format: "der", type: "spki" }).subarray(-32);
  const keyFile = join(directory, "reviewer.json");
  await writeFile(keyFile, JSON.stringify([...seed, ...publicKey]), { mode: 0o600 });
  bank.policy.reviewer = getAddressDecoder().decode(publicKey);
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    assert.equal(request.method, "getLatestBlockhash");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {
      context: { slot: 100 }, value: {
        blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1000,
      },
    } }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const options: WorkerOptions = {
    rpc: bank.rpc,
    rpcUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    inst: bank.inst, directory, submit: true, role: "reviewer", keyFile,
    source: bank.source, feed: bank.feed,
    beforeCollect: async () => { throw new Error("Collector is stopped"); },
  };
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    await rm(directory, { recursive: true });
  });
  return {
    bank, options,
    tick: (receipts = bank.receipts()) => walletTick(options, bank.owner, receipts),
    decision: () => withJournal(join(directory, "wallets"), bank.a.dividend_account,
      async journal => (journal.state as ReviewedLedger).reviews?.[bank.receiptKey]),
    outbox: () => withJournal(join(directory, "settlements"), bank.receiptKey,
      async journal => journal.state?.pending),
  };
}

test("a zero-approval review refunds before the hold ends, including during an incident", async t => {
  const { bank, options, tick, decision, outbox } = await scenario(t);
  await tick([]);
  bank.move("reward", 40n);
  bank.move("spend", 40n);
  bank.move("buy", 40n);
  bank.move("sweep", 40n);
  // Pausing before the first review must not hide the preceding receipt history.
  bank.config.pause_started_at = BigInt(bank.time());
  bank.config.paused_until = PAUSED;
  bank.removePool();
  const result = await tick();
  assert.equal("outcomes" in result && result.outcomes[0].action, "refund");
  assert.equal("outcomes" in result && result.outcomes[0].result, "submitted");
  assert.equal((await decision())?.amount, "0");
  assert.equal(bank.wires.length, 1);
  const transaction = getTransactionDecoder().decode(Buffer.from(bank.wires[0], "base64"));
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  if (message.version !== 0) throw new Error("Expected a v0 settlement transaction");
  const programInstructions = message.instructions.filter(ix =>
    message.staticAccounts[ix.programAddressIndex] === bank.inst.program);
  assert.equal(programInstructions.length, 1);
  assert.deepEqual([...programInstructions[0].data!], schema.instructions.refund_collection.discriminator);
  const prepared = await outbox();
  assert.equal(prepared?.wire, bank.wires[0]);
  // A restart with an unresolved broadcast must not sign or submit a new refund.
  options.rpc = (async (method, params) => {
    if (method === "getSignatureStatuses") return { value: [null] };
    if (method === "getBlockHeight") return 100;
    return bank.rpc(method, params);
  }) as RpcCall;
  const pending = await tick();
  assert.equal("outcomes" in pending && pending.outcomes[0].result, "pending");
  assert.equal((await outbox())?.wire, prepared?.wire);
  assert.equal(bank.wires.length, 1);
  options.rpc = bank.rpc;
  const finalized = await tick();
  assert.equal("outcomes" in finalized && finalized.outcomes[0].result, "reconciled");
  assert.equal(await outbox(), null);
  assert.equal(bank.wires.length, 1);
});

test("missing review is not a rejection; pause never postpones the fixed refund deadline", async t => {
  const { bank, options, tick, decision } = await scenario(t);
  options.submit = false;
  bank.move("reward", 40n);
  bank.move("sweep", 40n);
  bank.config.pause_started_at = BigInt(bank.time());
  bank.config.paused_until = PAUSED;
  const first = await tick(); // history begins after collection: no decision
  assert.equal(await decision(), undefined);
  assert.equal("outcomes" in first && first.outcomes[0].action, "wait");
  bank.advance(86400);
  const duringPause = await tick();
  assert.equal("outcomes" in duringPause && duringPause.outcomes[0].action, "wait");
  bank.advance(2 * 86400);
  const expired = await tick();
  assert.equal("outcomes" in expired && expired.outcomes[0].action, "refund");
  assert.equal(bank.wires.length, 0);
});

test("positive or partial approval cannot release during the hold or an incident", async t => {
  const { bank, options, tick, decision } = await scenario(t);
  options.submit = false;
  await tick([]);
  bank.move("reward", 40n);
  bank.move("spend", 25n);
  bank.move("buy", 25n);
  bank.move("sweep", 40n);
  bank.config.pause_started_at = BigInt(bank.time());
  bank.config.paused_until = PAUSED;
  const early = await tick();
  assert.equal((await decision())?.amount, "15");
  assert.equal("outcomes" in early && early.outcomes[0].action, "wait");
  bank.advance(86400);
  const paused = await tick();
  assert.equal("outcomes" in paused && paused.outcomes[0].action, "wait");
  bank.config.paused_until = BigInt(bank.time());
  const resumed = await tick();
  assert.equal("outcomes" in resumed && resumed.outcomes[0].action, "clear");
  assert.equal(bank.wires.length, 0);
});

test("invalid or absent review evidence cannot trigger early clearance or rejection", async t => {
  const { bank } = await scenario(t);
  bank.move("reward", 40n);
  bank.move("sweep", 40n);
  const snapshot = await holdSnapshot(bank.rpc, bank.inst, bank.owner, 0, "reviewer");
  const rejected = { amount: "0", evidenceHash: "a".repeat(64), sweepSignature: "sweep", collectedAt: bank.receipt.collected_at.toString() };
  assert.equal(settlementPlan(bank.receipt, snapshot, rejected), "refund");
  assert.equal(settlementPlan(bank.receipt, snapshot, undefined), "wait");
  assert.equal(settlementPlan(bank.receipt, snapshot, { ...rejected, evidenceHash: "invalid" }), "wait");
  assert.equal(settlementPlan(bank.receipt, snapshot, { ...rejected, amount: "40" }), "wait");
});

test("reviewing while inactive never carries unused rewards into resumed collections", async t => {
  const { bank, options, tick, decision } = await scenario(t);
  options.submit = false;
  await tick([]);
  bank.config.pause_started_at = BigInt(bank.time());
  bank.config.paused_until = PAUSED;
  bank.move("reward", 40n);
  await tick([]);
  await withJournal(join(options.directory, "wallets"), bank.a.dividend_account,
    async journal => assert.equal(journal.state?.eligible, "0"));
  bank.config.paused_until = BigInt(bank.time());
  bank.move("buy", 40n);
  bank.move("sweep", 40n);
  const result = await tick();
  assert.equal((await decision())?.amount, "0");
  assert.equal("outcomes" in result && result.outcomes[0].action, "refund");
});
