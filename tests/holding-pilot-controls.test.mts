import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddressDecoder, getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";
import { pilotLimit, workerArgs, PILOT_LIMIT_FILE, type PilotRequest } from "../lib/holding/pilot.ts";
import { walletTick, type WorkerOptions } from "../lib/holding/worker.ts";
import { withJournal } from "../lib/reporter/journal.ts";
import type { RpcCall } from "../lib/reporter/rpc.ts";
import type { ReviewedLedger } from "../lib/holding/reconcile.ts";
import { holdPda } from "../lib/holding/client.ts";
import { schema } from "../lib/holding/codec.ts";
import { holdingBank } from "./support/holding-bank.mts";

const PUMP = 1_000_000n, MAX = 1_000n * PUMP, APPROVE = 600n * PUMP;
const owner = "HpsRzXK3xWQxD1Px1KoExP5KYWs5gByEu47z6Ne6gDNf";
const collectArgs = ["--role=collector", "--mode=founders", "--collection-cap-raw=1000000000",
  `--pilot-owner=${owner}`, "--pilot-consent-epoch=4", "--pilot-nonce=0"];

test("pilot CLI rejects typos, duplicates, invalid units, missing scope and wrong roles", () => {
  assert.equal(workerArgs(collectArgs).pilot?.maxAmount, MAX.toString());
  assert.equal(workerArgs(["--role=reviewer", `--pilot-receipt=${owner}`, "--approval-cap-raw=0"]).pilot?.maxAmount, "0");
  for (const value of ["", "-1", "0", "1.5", "1e9", "01", "18446744073709551616"]) {
    assert.throws(() => workerArgs(collectArgs.map(a => a.startsWith("--collection-cap-raw=") ? `--collection-cap-raw=${value}` : a)));
  }
  for (const args of [
    [...collectArgs, "--collection-cap-raw=2000000000"],
    collectArgs.map(a => a.replace("--collection-cap-raw=", "--collection-cpa-raw=")),
    collectArgs.filter(a => !a.startsWith("--pilot-nonce=")),
    collectArgs.map(a => a.replace("--mode=founders", "--mode=public")),
    collectArgs.map(a => a.replace("--role=collector", "--role=reviewer")),
    collectArgs.map(a => a.replace("--pilot-consent-epoch=4", "--pilot-consent-epoch=0")),
    [...collectArgs, "--approval-cap-raw=1"],
    ["--role=reviewer", "--approval-cap-raw=600000000"],
    ["--role=reviewer", `--pilot-receipt=${owner}`, "--approval-cap-raw=-1"],
  ]) assert.throws(() => workerArgs(args));
});

async function scenario(t: TestContext, role: "collector" | "reviewer") {
  const bank = await holdingBank(), root = await mkdtemp(join(tmpdir(), "hold-pilot-"));
  t.mock.method(Date, "now", () => bank.time() * 1000);
  bank.landlord.counted_amount = 10_000n * PUMP; bank.landlord.snapshot = 10_000n * PUMP;
  bank.config.params.max_buy_per_day = 10_000n * PUMP;
  bank.config.params.max_buy_per_tx = 10_000n * PUMP;
  bank.config.params.max_rewards_per_day = 10_000n * PUMP;
  // Deterministic public fixture keys, never production signing material.
  const seed = Buffer.alloc(32, role === "collector" ? 94 : 95);
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
    format: "der", type: "pkcs8" });
  const pubkey = createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32);
  bank.policy[role] = getAddressDecoder().decode(pubkey);
  const keyFile = join(root, "fixture-key.json");
  await writeFile(keyFile, JSON.stringify([...seed, ...pubkey]), { mode: 0o600 });
  let signatures = 0;
  const server = createServer(async (req, res) => {
    let body = ""; for await (const part of req) body += part;
    const request = JSON.parse(body);
    assert.equal(request.method, "getLatestBlockhash"); signatures++;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { context: { slot: 100 },
      value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1000 } } }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    await rm(root, { recursive: true, force: true });
  });
  const directory = join(root, role), controls = { mode: "founders" as const, founders: new Set<string>([bank.owner]),
    stopFile: join(root, "stop") };
  const request: PilotRequest = role === "collector"
    ? { role, owner: bank.owner, consentEpoch: bank.consent.epoch.toString(), nonce: bank.consent.next_nonce.toString(), maxAmount: MAX.toString() }
    : { role, receipt: bank.receiptKey, maxAmount: APPROVE.toString() };
  const input = { directory, role, inst: bank.inst, controls, submit: true };
  const options: WorkerOptions = { rpc: bank.rpc,
    rpcUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, inst: bank.inst,
    directory, submit: false, role, keyFile, source: bank.source, feed: bank.feed };
  const reload = async (next?: PilotRequest) => { options.pilot = await pilotLimit({ ...input, request: next }); };
  const tick = (receipts = role === "reviewer" ? bank.receipts() : []) => walletTick(options, bank.owner, receipts);
  const decision = () => withJournal(join(directory, "wallets"), bank.a.dividend_account,
    async j => structuredClone((j.state as ReviewedLedger).reviews?.[bank.receiptKey]));
  const ixs = (wire = bank.wires.at(-1)!) => {
    const message = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(Buffer.from(wire, "base64")).messageBytes);
    if (message.version !== 0) throw new Error("Expected v0 fixture transaction");
    return message.instructions.filter(ix => message.staticAccounts[ix.programAddressIndex] === bank.inst.program)
      .map(ix => Buffer.from(ix.data!));
  };
  return { bank, options, request, input, reload, tick, decision, ixs, signatures: () => signatures };
}

test("pilot control is preview-only without submit, then persists with no flags and cannot be silently widened", async t => {
  const { input, request, bank } = await scenario(t, "collector");
  const preview = await pilotLimit({ ...input, request, submit: false });
  assert.equal(preview?.maxAmount, MAX.toString());
  await assert.rejects(readFile(join(input.directory, PILOT_LIMIT_FILE)), { code: "ENOENT" });
  const first = await pilotLimit({ ...input, request });
  assert.deepEqual(await pilotLimit(input), first);
  assert.deepEqual(await pilotLimit({ ...input, submit: false }), first);
  for (const changed of [
    { ...request, maxAmount: (MAX + 1n).toString() },
    { ...request, nonce: "1" },
    { ...request, consentEpoch: "99" },
  ] as PilotRequest[]) await assert.rejects(pilotLimit({ ...input, request: changed }), /pinned/);
  await assert.rejects(pilotLimit({ ...input, role: "reviewer" }), /different/);
  await assert.rejects(pilotLimit({ ...input, inst: { ...bank.inst, config: bank.inst.program } }), /different/);
  await assert.rejects(pilotLimit({ ...input, controls: { ...input.controls, mode: "public" } }), /founders/);
  await assert.rejects(pilotLimit({ ...input, controls: { ...input.controls, founders: new Set([bank.owner, bank.inst.program]) } }), /exactly/);
  await writeFile(join(input.directory, PILOT_LIMIT_FILE), "{truncated");
  await assert.rejects(pilotLimit(input));
});

test("collector signs at most 1,000 PUMP once, retains full reward evidence, and never rolls into the next nonce", async t => {
  const { bank, options, request, reload, tick, ixs, signatures } = await scenario(t, "collector");
  await reload(request); await tick();
  bank.move("reward", 5_000n * PUMP);
  const dry = await tick();
  assert.equal("amount" in dry && dry.amount, MAX.toString());
  assert.equal("eligible" in dry && dry.eligible, (5_000n * PUMP).toString());
  options.submit = true;
  assert.equal((await tick()).status, "submitted");
  const [sweep] = ixs();
  assert.deepEqual([...sweep.subarray(0, 8)], schema.instructions.sweep.discriminator);
  // discriminator, nonce, consent_epoch, expected_balance, amount
  assert.equal(sweep.readBigUInt64LE(32), MAX);
  bank.move("sweep", MAX);
  await reload(); // restarting with the CLI flags omitted still loads the same limit
  await tick(); // reconcile persisted submission and source history
  bank.move("reward", 2_000n * PUMP);
  assert.equal((await tick()).status, "idle");
  assert.equal(bank.wires.length, 1); assert.equal(signatures(), 1);
});

test("collector still respects smaller eligibility, changed consent and quarantine before signing", async t => {
  const { bank, options, request, reload, tick, signatures } = await scenario(t, "collector");
  await reload(request); await tick(); bank.move("reward", 400n * PUMP);
  const dry = await tick(); assert.equal("amount" in dry && dry.amount, (400n * PUMP).toString());
  options.submit = true; options.beforeCollect = async () => { throw new Error("Quarantined"); };
  await assert.rejects(tick(), /Quarantined/);
  assert.equal(signatures(), 0);
  delete options.beforeCollect;
  bank.consent.epoch++; await tick(); bank.move("reward", 2_000n * PUMP);
  assert.equal((await tick()).status, "idle");
  assert.equal(signatures(), 0); assert.equal(bank.wires.length, 0);
});

test("ambiguous capped collection is reconciled across restart without another signature or debit", async t => {
  const { bank, options, request, reload, tick, signatures } = await scenario(t, "collector");
  await reload(request); await tick(); bank.move("reward", 5_000n * PUMP);
  options.submit = true;
  options.rpc = (async (method, params) => {
    if (method === "sendTransaction") { await bank.rpc(method, params); throw new Error("Response lost"); }
    if (method === "getSignatureStatuses") return { value: [null] };
    if (method === "getBlockHeight") return 999;
    return bank.rpc(method, params);
  }) as RpcCall;
  await assert.rejects(tick(), /Response lost/);
  await reload(); assert.equal((await tick()).status, "pending");
  assert.equal(signatures(), 1); assert.equal(bank.wires.length, 1);
  bank.move("sweep", MAX); options.rpc = bank.rpc;
  await tick(); assert.equal((await tick()).status, "idle");
  assert.equal(signatures(), 1); assert.equal(bank.wires.length, 1);
});

for (const [verified, cap, expected] of [[1_000n, 600n, 600n], [400n, 600n, 400n], [0n, 600n, 0n], [1_000n, 0n, 0n]]) {
  test(`reviewer caps 1,000 held at min(${verified} verified, ${cap}), retaining the independent decision`, async t => {
    const { bank, options, request, reload, tick, decision, ixs } = await scenario(t, "reviewer");
    await reload({ ...request, maxAmount: (cap * PUMP).toString() }); await tick([]); bank.move("reward", MAX);
    if (verified < 1_000n) { bank.move("spend", MAX - verified * PUMP); bank.move("buy", MAX - verified * PUMP); }
    bank.move("sweep", MAX); await tick();
    const independent = await decision(); assert.equal(independent!.amount, (verified * PUMP).toString());
    bank.advance(86400);
    const preview = await tick();
    assert.equal("outcomes" in preview && preview.outcomes[0].plannedApprovalRaw, (expected * PUMP).toString());
    assert.equal("outcomes" in preview && preview.outcomes[0].plannedRefundRaw, ((1_000n - expected) * PUMP).toString());
    options.submit = true; await tick();
    assert.deepEqual(await decision(), independent);
    const instructions = ixs();
    if (expected === 0n) {
      assert.equal(instructions.length, 1);
      assert.deepEqual([...instructions[0]], schema.instructions.refund_collection.discriminator);
    } else {
      assert.equal(instructions.length, 2);
      assert.deepEqual([...instructions[0].subarray(0, 8)], schema.instructions.review_collection.discriminator);
      assert.equal(instructions[0].readBigUInt64LE(8), expected * PUMP);
      assert.equal(instructions[0].subarray(16).toString("hex"), independent!.evidenceHash);
      assert.deepEqual([...instructions[1]], schema.instructions.release_collection.discriminator);
      assert.equal(bank.receipt.amount - instructions[0].readBigUInt64LE(8), (1_000n - expected) * PUMP);
    }
  });
}

test("reviewer waits for the hold and fresh evidence; an expired submission retries with the persisted cap", async t => {
  const { bank, options, request, reload, tick, signatures, ixs } = await scenario(t, "reviewer");
  await reload(request); await tick([]); bank.move("reward", MAX); bank.move("sweep", MAX);
  options.submit = true; await tick(); assert.equal(signatures(), 0);
  bank.advance(86400);
  options.beforeRelease = async () => { throw new Error("Feed unavailable"); };
  await tick(); assert.equal(signatures(), 0);
  let checks = 0, height = 999;
  options.beforeRelease = async () => { if (++checks > 1) throw new Error("Feed became stale before broadcast"); };
  await tick(); assert.equal(signatures(), 1); assert.equal(bank.wires.length, 0);
  options.rpc = (async (method, params) => {
    if (method === "getSignatureStatuses") return { value: [null] };
    if (method === "getBlockHeight") return height;
    return bank.rpc(method, params);
  }) as RpcCall;
  await reload(); delete options.beforeRelease;
  await tick(); assert.equal(signatures(), 1);
  height = 1001; await tick(); assert.equal(signatures(), 1); // reconcile only
  await tick(); assert.equal(signatures(), 2); assert.equal(bank.wires.length, 1);
  assert.equal(ixs()[0].readBigUInt64LE(8), APPROVE);
});

for (const [approved, action] of [[500n, "release_collection"], [700n, "refund_collection"]] as const) {
  test(`a prior immutable ${approved} PUMP review with a 600 cap selects ${action} without a replacement review`, async t => {
    const { bank, options, request, reload, tick, decision, ixs } = await scenario(t, "reviewer");
    await reload(request); await tick([]); bank.move("reward", MAX); bank.move("sweep", MAX); await tick();
    bank.advance(86400); bank.receipt.reviewed = true;
    bank.receipt.review_evidence = [...Buffer.from((await decision())!.evidenceHash, "hex")];
    bank.receipt.approved_amount = approved * PUMP;
    options.submit = true; await tick();
    assert.deepEqual(ixs().map(ix => [...ix]), [schema.instructions[action].discriminator]);
    assert.equal(bank.receipt.approved_amount, approved * PUMP);
  });
}

test("pilot reviewer blocks other positive releases, but their incident refunds remain available", async t => {
  const { bank, options, request, reload, tick, signatures, ixs } = await scenario(t, "reviewer");
  assert.equal(request.role, "reviewer");
  await reload({ role: "reviewer", receipt: await holdPda(bank.inst, "receipt", bank.owner, 1n), maxAmount: APPROVE.toString() });
  await tick([]); bank.move("reward", MAX); bank.move("sweep", MAX); await tick();
  bank.advance(86400); options.submit = true;
  await tick(); assert.equal(signatures(), 0);
  bank.config.pause_started_at = bank.receipt.collected_at;
  bank.config.paused_until = (1n << 63n) - 1n;
  options.beforeRelease = async () => { throw new Error("Feed unavailable"); };
  await tick(); assert.equal(signatures(), 1);
  assert.deepEqual(ixs().map(ix => [...ix]), [schema.instructions.refund_collection.discriminator]);
});
