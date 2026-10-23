import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddressDecoder, getTransactionDecoder, getCompiledTransactionMessageDecoder } from "@solana/kit";
import { holdingBank } from "./support/holding-bank.mts";
import { walletTick, type WorkerOptions } from "../lib/holding/worker.ts";
import { withJournal } from "../lib/reporter/journal.ts";
import { holdSnapshot } from "../lib/holding/snapshot.ts";
import type { RpcCall } from "../lib/reporter/rpc.ts";
import type { ReviewedLedger } from "../lib/holding/reconcile.ts";
import { schema } from "../lib/holding/codec.ts";

async function scenario(t: TestContext) {
  const bank = await holdingBank(), directory = await mkdtemp(join(tmpdir(), "tracked-rewards-"));
  t.mock.method(Date, "now", () => bank.time() * 1000);
  bank.landlord.reserved[0] = 1;
  const paths: Record<string, string> = {};
  for (const [role, byte] of [["collector", 91], ["reviewer", 92]] as const) {
    const seed = Buffer.alloc(32, byte);
    const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
    const publicKey = createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32);
    paths[role] = join(directory, `${role}.json`);
    await writeFile(paths[role], JSON.stringify([...seed, ...publicKey]), { mode: 0o600 });
    bank.policy[role] = getAddressDecoder().decode(publicKey);
  }
  let signaturesPrepared = 0;
  const server = createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const request = JSON.parse(body);
    assert.equal(request.method, "getLatestBlockhash"); signaturesPrepared++;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { context: { slot: 100 }, value: {
      blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1000,
    } } }));
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const options = Object.fromEntries((["collector", "reviewer"] as const).map(role => [role, {
    rpc: bank.rpc, rpcUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    inst: bank.inst, directory: join(directory, role), submit: true, role,
    keyFile: paths[role], source: bank.source, feed: bank.feed, authorizeCollections: true,
  }])) as Record<"collector" | "reviewer", WorkerOptions>;
  t.after(async () => {
    await new Promise<void>((r, reject) => server.close(e => e ? reject(e) : r()));
    await rm(directory, { recursive: true });
  });
  const tick = (role: "collector" | "reviewer", receipts: ReturnType<typeof bank.receipts> = []) => walletTick(options[role], bank.owner, receipts);
  await tick("collector"); await tick("reviewer");
  return { bank, options, tick, directory, signaturesPrepared: () => signaturesPrepared };
}
function authorization(result: Awaited<ReturnType<typeof walletTick>>) {
  assert.ok("authorization" in result && result.authorization);
  return result.authorization;
}
function instructionData(wire: string, name: string, program: string) {
  assert.ok(Buffer.from(wire, "base64").length <= 1232);
  const tx = getTransactionDecoder().decode(Buffer.from(wire, "base64"));
  const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  assert.equal(msg.version, 0);
  const ix = msg.instructions.find(ix => msg.staticAccounts[ix.programAddressIndex] === program);
  assert.ok(ix?.data);
  assert.deepEqual([...ix.data.slice(0, 8)], schema.instructions[name].discriminator);
  return { data: Buffer.from(ix.data), msg, ix };
}

test("both workers collect only new unspent rewards after spending below the initial balance", async t => {
  const { bank, tick, directory } = await scenario(t);
  // Start with 20; spend 15, buy 2, receive 6 -> 13, below the original floor.
  bank.move("spend", 15n); bank.move("buy", 2n); bank.move("reward", 6n);
  assert.equal((await tick("collector")).status, "idle"); // No independent permit yet.
  const grant = authorization(await tick("reviewer"));
  assert.equal(grant.status, "submitted"); assert.equal("amount" in grant && grant.amount, "6");
  const { data } = instructionData(bank.wires[0], "authorize_collection", bank.inst.program);
  assert.equal(data.readBigUInt64LE(8), 0n); // nonce
  assert.equal(data.readBigUInt64LE(24), 13n); // exact observed balance
  assert.equal(data.readBigUInt64LE(32), 6n); // independently eligible amount
  // These values are inside the signed instruction, not adopted at execution.
  assert.equal(getAddressDecoder().decode(data.subarray(80, 112)), bank.policy.collector);
  assert.equal(getAddressDecoder().decode(data.subarray(112, 144)), bank.policy.reviewer);
  assert.equal(data.readBigInt64LE(144), bank.config.last_count_at);
  assert.equal(data.readUInt32LE(152), bank.config.refresher_epoch);
  assert.equal(data.readBigInt64LE(156), bank.config.pause_started_at);
  assert.equal(data.readBigInt64LE(164), BigInt(Math.floor(bank.time() / 86400)));
  bank.authorize(6n); // Apply modeled result; the Rust suite executes the real instruction.
  bank.reference(); // Authorization reads the PUMP account without moving tokens.
  bank.advance(300); // Five-minute timers can be offset; grant is still usable.
  const collected = await tick("collector");
  assert.equal(collected.status, "submitted"); assert.equal("amount" in collected && collected.amount, "6");
  const sweep = instructionData(bank.wires[1], "sweep", bank.inst.program);
  assert.equal(sweep.data.readBigUInt64LE(32), 6n);
  assert.equal(sweep.msg.staticAccounts[sweep.ix.accountIndices!.at(-1)!], bank.permitKey);
  bank.move("sweep", 6n);
  await tick("reviewer", bank.receipts());
  await withJournal(join(directory, "reviewer", "wallets"), bank.a.dividend_account, async j => {
    assert.equal((j.state as ReviewedLedger).reviews![bank.receiptKey].amount, "6");
    assert.equal(j.state!.eligible, "0");
  });
  assert.equal(bank.landlord.baseline, 7n);
  await tick("collector"); // Reconcile the signed transaction and replay the sweep.
  bank.move("reward", 4n);
  const next = authorization(await tick("reviewer", bank.receipts()));
  assert.equal(next.status, "submitted"); assert.equal("amount" in next && next.amount, "4");
  bank.authorize(4n);
  const second = await tick("collector");
  assert.equal("amount" in second && second.amount, "4");
});

test("spent rewards, repurchases, incoming transfers and refunds never replenish eligibility", async t => {
  const { bank, tick } = await scenario(t);
  bank.move("reward", 9n); bank.move("spend", 12n); bank.move("buy", 12n); bank.move("refund", 5n);
  assert.equal(authorization(await tick("reviewer")).status, "idle");
  assert.equal((await tick("collector")).status, "idle");
  assert.equal(bank.wires.length, 0);
  bank.move("reward", 8n); bank.move("spend", 3n);
  const grant = authorization(await tick("reviewer"));
  assert.equal("amount" in grant && grant.amount, "5");
  bank.authorize(5n);
  const result = await tick("collector");
  assert.equal("amount" in result && result.amount, "5");
});

test("a stale grant cannot override the collector's more recent spend/rebuy history", async t => {
  const { bank, tick } = await scenario(t);
  bank.move("reward", 10n);
  await tick("reviewer"); bank.authorize(10n);
  bank.move("spend", 10n); bank.move("buy", 10n); // Same balance, different provenance.
  assert.equal((await tick("collector")).status, "idle");
  assert.equal(bank.wires.length, 1); // only the authorization, no token collection
});

test("reviewer still refunds a spend/rebuy race after a tracked collection was signed", async t => {
  const { bank, tick, directory } = await scenario(t);
  bank.move("reward", 10n); await tick("reviewer"); bank.authorize(10n);
  await tick("collector");
  bank.move("spend", 10n); bank.move("buy", 10n); bank.move("sweep", 10n);
  const reviewed = await tick("reviewer", bank.receipts());
  assert.equal("outcomes" in reviewed && reviewed.outcomes[0].action, "refund");
  await withJournal(join(directory, "reviewer", "wallets"), bank.a.dividend_account, async j => {
    assert.equal((j.state as ReviewedLedger).reviews![bank.receiptKey].amount, "0");
  });
});

test("permit validity follows balances, roles, consent, count, pause and expiry", async t => {
  const { bank } = await scenario(t);
  bank.authorize(5n);
  assert.equal((await holdSnapshot(bank.rpc, bank.inst, bank.owner)).allowance, "5");
  for (const fields of [
    { expected_balance: 21n }, { consent_epoch: bank.consent.epoch + 1n }, { nonce: 1n },
    { collector: bank.owner }, { reviewer: bank.owner }, { count_at: 0n },
    { refresher_epoch: bank.config.refresher_epoch + 1 }, { pause_started_at: 1n },
    { observation_day: BigInt(Math.floor(bank.time() / 86400)) - 1n },
    { valid_until: BigInt(bank.time() + 44) }, { evidence_hash: Array(32).fill(0) },
  ]) {
    bank.authorize(5n, fields);
    assert.equal((await holdSnapshot(bank.rpc, bank.inst, bank.owner)).allowance, "0");
  }
});

test("a pre-funded uninitialized permit is absent, not a global history failure", async t => {
  const { bank } = await scenario(t);
  const rpc: RpcCall = async <T,>(method: string, params: unknown[]) => {
    const result = await bank.rpc<T>(method, params);
    if (method === "getMultipleAccounts") (result as { value: unknown[] }).value[(params[0] as string[]).indexOf(bank.permitKey)] = {
      owner: "11111111111111111111111111111111", data: ["", "base64"],
    };
    return result;
  };
  const s = await holdSnapshot(rpc, bank.inst, bank.owner);
  assert.equal(s.permit, null); assert.equal(s.allowance, "0"); assert.equal(s.active, true);
});

test("ambiguous authorization broadcast is durable, never re-signed or blindly resent", async t => {
  const { bank, options, tick, directory, signaturesPrepared } = await scenario(t);
  bank.move("reward", 10n);
  let height = 99;
  options.reviewer.rpc = (async (method, params) => {
    if (method === "sendTransaction") throw new Error("timeout after broadcast");
    if (method === "getSignatureStatuses") return { value: [null] };
    if (method === "getBlockHeight") return height;
    return bank.rpc(method, params);
  }) as RpcCall;
  await assert.rejects(() => tick("reviewer"), /timeout/);
  const readPending = () => withJournal(join(directory, "reviewer", "permits"), bank.permitKey, async j => j.state?.pending);
  const pending = await readPending(); assert.ok(pending);
  assert.equal(authorization(await tick("reviewer")).status, "pending");
  assert.equal((await readPending())?.wire, pending.wire);
  assert.equal(signaturesPrepared(), 1);
  height = 1001;
  assert.equal(authorization(await tick("reviewer")).status, "reconciled");
  assert.equal(signaturesPrepared(), 1);
  assert.equal(await readPending(), null);
});

test("a changing cursor or an unavailable feed blocks new authorization", async t => {
  const { bank, options, tick, signaturesPrepared } = await scenario(t);
  bank.move("reward", 10n);
  options.reviewer.beforeAuthorize = async () => { bank.move("spend", 1n); bank.move("buy", 1n); };
  await assert.rejects(() => tick("reviewer"), /history changed/);
  assert.equal(signaturesPrepared(), 0);
  options.reviewer.beforeAuthorize = async () => { throw new Error("Feed unavailable"); };
  await assert.rejects(() => tick("reviewer"), /Feed unavailable/);
  assert.equal(signaturesPrepared(), 0); assert.equal(bank.wires.length, 0);
});

test("reviewer submission alone does not opt into signing collection permits", async t => {
  const { bank, options, tick } = await scenario(t);
  options.reviewer.authorizeCollections = false;
  bank.move("reward", 10n);
  assert.equal(authorization(await tick("reviewer")).status, "dry_run");
  assert.equal(bank.wires.length, 0);
});

test("lost reviewer history and uncertain history cannot authorize old balances", async t => {
  const { bank, options, tick } = await scenario(t);
  bank.move("reward", 10n);
  options.reviewer.directory = join(options.reviewer.directory, "fresh");
  assert.equal(authorization(await tick("reviewer")).status, "idle");
  assert.equal(bank.wires.length, 0);
  bank.move("reward", 5n);
  options.reviewer.rpc = (async (method, params) => {
    if (method === "getTransaction") return null;
    return bank.rpc(method, params);
  }) as RpcCall;
  await assert.rejects(() => tick("reviewer"));
  assert.equal(bank.wires.length, 0);
});

for (const changed of ["pause", "collector"] as const) {
  test(`reviewer discards old grant eligibility after a ${changed} boundary`, async t => {
    const { bank, options, tick } = await scenario(t);
    bank.move("reward", 10n);
    options.reviewer.submit = false;
    const first = authorization(await tick("reviewer"));
    assert.equal(first.status, "dry_run");
    assert.equal("amount" in first && first.amount, "10");
    assert.equal((await tick("collector")).status, "idle");
    if (changed === "pause") {
      bank.config.pause_started_at = BigInt(bank.time());
      bank.config.paused_until = BigInt(bank.time() + 1);
    } else bank.policy.collector = bank.owner;
    bank.advance(2);
    assert.equal((await tick("collector")).status, "boundary");
    options.reviewer.submit = true;
    assert.equal(authorization(await tick("reviewer")).status, "idle");
    assert.equal(bank.wires.length, 0);
  });

  test(`a ${changed} change during authorization cannot reuse the prior review`, async t => {
    const { bank, options, tick, signaturesPrepared } = await scenario(t);
    bank.move("reward", 10n);
    options.reviewer.beforeAuthorize = async () => {
      if (changed === "pause") {
        bank.config.pause_started_at = BigInt(bank.time());
        bank.config.paused_until = BigInt(bank.time() + 1);
      } else bank.policy.collector = bank.owner;
      bank.advance(2);
    };
    await assert.rejects(() => tick("reviewer"), /State or history changed/);
    assert.equal(signaturesPrepared(), 0);
    assert.equal(bank.wires.length, 0);
  });
}

test("a grant boundary preserves receipt replay and permits only subsequently observed rewards", async t => {
  const { bank, options, tick, directory } = await scenario(t);
  options.reviewer.submit = false;
  bank.move("reward", 10n);
  assert.equal(authorization(await tick("reviewer")).status, "dry_run");
  // The earlier collector's receipt has not yet been seen by the reviewer.
  bank.move("sweep", 4n);
  bank.policy.collector = bank.owner;
  const result = await tick("reviewer", bank.receipts());
  assert.equal(authorization(result).status, "idle");
  assert.equal("outcomes" in result && result.outcomes[0].action, "wait");
  await withJournal(join(directory, "reviewer", "wallets"), bank.a.dividend_account, async j => {
    assert.equal((j.state as ReviewedLedger).reviews![bank.receiptKey].amount, "4");
    assert.equal(j.state!.eligible, "0");
  });
  bank.move("reward", 3n);
  const next = authorization(await tick("reviewer", bank.receipts()));
  assert.equal(next.status, "dry_run");
  assert.equal("amount" in next && next.amount, "3");
});

for (const changed of ["pause", "collector"] as const) {
  test(`delayed payout evidence cannot revive rewards across a ${changed} boundary`, async t => {
    const { bank, options, tick, directory } = await scenario(t);
    options.reviewer.submit = false;
    bank.move("reward", 10n);
    assert.equal(authorization(await tick("reviewer")).status, "dry_run");
    let previousBoundary: string | undefined;
    await withJournal(join(directory, "reviewer", "wallets"), bank.a.dividend_account, async j => {
      previousBoundary = (j.state as ReviewedLedger).authorizationBinding;
    });
    bank.move("reward", 5n);
    const savedFeed = new Map(bank.feed.records);
    bank.feed.records.clear();
    if (changed === "pause") {
      bank.config.pause_started_at = BigInt(bank.time() + 1);
      bank.config.paused_until = BigInt(bank.time() + 1);
    } else bank.policy.collector = bank.owner;
    bank.advance(2);
    assert.equal((await tick("reviewer")).status, "awaiting_payout");
    await withJournal(join(directory, "reviewer", "wallets"), bank.a.dividend_account, async j => {
      assert.equal((j.state as ReviewedLedger).authorizationBinding, previousBoundary);
    });
    for (const [key, value] of savedFeed) bank.feed.records.set(key, value);
    options.reviewer.submit = true;
    assert.equal(authorization(await tick("reviewer")).status, "idle");
    assert.equal(bank.wires.length, 0);
    bank.move("reward", 2n);
    const fresh = authorization(await tick("reviewer"));
    assert.equal(fresh.status, "submitted");
    assert.equal("amount" in fresh && fresh.amount, "2");
  });
}
