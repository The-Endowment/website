import { boundary } from "../lib/reporter/ledger.ts";
import { holdSnapshot } from "../lib/holding/snapshot.ts";
import { walletPayouts, VERIFICATION_VERSION } from "../lib/reporter/payouts.ts";
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

test("mixed-owner payout → collector → held receipt → independent partial review → refund protection → future payout", async (t) => {
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
    const reward = bank.move("reward", 40n);
    // Same transaction also pays a different coin to another owner. There is
    // deliberately no API record for that owner in this coin's feed.
    const other = "J".repeat(32), otherOwner = "K".repeat(32);
    reward.transaction.message.accountKeys.push({pubkey: other, signer: false});
    const otherBalance = {accountIndex: 2, owner: otherOwner, mint: bank.inst.dividendMint,
      programId: bank.inst.dividendTokenProgram, uiTokenAmount: {amount: "0", decimals: 6}};
    reward.meta!.preTokenBalances.push(otherBalance);
    reward.meta!.postTokenBalances.push({...otherBalance, uiTokenAmount: {amount: "50", decimals: 6}});
    reward.transaction.message.instructions.push({programId: bank.inst.dividendTokenProgram, parsed: {
      type: "transferChecked", info: {source: bank.source.source, destination: other, authority: bank.source.authority,
        mint: bank.inst.dividendMint, tokenAmount: {amount: "50", decimals: 6}}}});
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

test("after the payout evidence retry deadline, a completed review refunds even without the pool", async (t) => {
  const bank = await holdingBank(), directory = await mkdtemp(join(tmpdir(), "hold-missing-evidence-"));
  t.mock.method(Date, "now", () => bank.time() * 1000);
  const options: WorkerOptions = { rpc: bank.rpc, rpcUrl: "http://127.0.0.1", inst: bank.inst,
    directory, submit: false, role: "reviewer", source: bank.source, feed: walletPayouts([], {mint: bank.inst.coinMint, quoteMint: bank.inst.dividendMint}) };
  try {
    await walletTick(options, bank.owner, []);
    bank.move("reward", 40n); bank.move("sweep", 40n);
    assert.equal((await walletTick(options, bank.owner, bank.receipts())).status, "awaiting_payout");
    bank.advance(6 * 3600);
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
      options.submit = true; options.loadFeed = async () => walletPayouts([], {mint: bank.inst.coinMint, quoteMint: bank.inst.dividendMint});
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
      directory, submit: false, role, source: bank.source, feed: walletPayouts([], {mint: bank.inst.coinMint, quoteMint: bank.inst.dividendMint}),
      loadFeed: async () => {
        // This is the independent capture's newer snapshot, made available
        // while the worker was still reading finalized wallet transactions.
        assert.equal(calls.at(-1), "getTransaction");
        assert.equal(calls.filter(method => method === "getTransaction").length,
          role === "collector" ? 1 : 2);
        calls.push("loadFeed");
        return {...bank.feed, records: new Map(bank.feed.records)};
      },
    };
    try {
      assert.equal((await walletTick(options, bank.owner, [])).status,
        role === "collector" ? "boundary" : "reviewed");
      calls.length = 0;
      bank.move("reward", 40n);
      if (role === "reviewer") bank.move("sweep", 40n);
      const result = await walletTick(options, bank.owner, role === "reviewer" ? bank.receipts() : []);
      assert.equal(options.feed.records.size, 0);
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

for (const outcome of ["finalized", "failed", "expired"] as const) {
  test(`verifier migration reconciles an old signed clear (${outcome}) before any replacement settlement`, async t => {
    const bank = await holdingBank(), directory = await mkdtemp(join(tmpdir(), "hold-verifier-migration-"));
    t.after(() => rm(directory, {recursive:true, force:true}));
    t.mock.method(Date, "now", () => bank.time() * 1000);
    bank.move("reward",40n); bank.move("sweep",40n);
    const before = await holdSnapshot(bank.rpc,bank.inst,bank.owner,0,"reviewer");
    assert.ok(before.binding.startsWith(VERIFICATION_VERSION + ":"));
    const collector = await holdSnapshot(bank.rpc,bank.inst,bank.owner);
    assert.ok(collector.binding.startsWith(VERIFICATION_VERSION + ":"));
    await withJournal(join(directory,"wallets"),bank.a.dividend_account, async journal => {
      await journal.save({...boundary("legacy-verifier",before.slot,"old",before.balance), reviewer:bank.policy.reviewer,
        reviews:{[bank.receiptKey]:{amount:"40",evidenceHash:"a".repeat(64),sweepSignature:"old-sweep",collectedAt:String(bank.time())}}} as ReviewedLedger,"Legacy fixture");
    });
    await withJournal(join(directory,"settlements"),bank.receiptKey, async journal => {
      await journal.save({...boundary(bank.receiptKey,0,null,"0"),pending:{wire:"old-clear-bytes",signature:"old-clear",
        amount:"40",nonce:"0",expiresAt:1,lastValidBlockHeight:"100",evidenceHash:"a".repeat(64)}},"Old clear prepared");
    });
    let resolved = false, reads = 0;
    const rpc: WorkerOptions["rpc"] = async <T,>(method:string,params:unknown[]) => {
      if(method === "getSignatureStatuses") return {value:[resolved && outcome !== "expired"
        ? {confirmationStatus:"finalized",err:outcome === "failed" ? {failure:1} : null} : null]} as T;
      if(method === "getBlockHeight") return (resolved ? 101 : 100) as T;
      if(method === "sendTransaction") throw new Error("Must never rebroadcast old clear");
      if(method === "getAccountInfo") reads++;
      return bank.rpc<T>(method,params);
    };
    const options: WorkerOptions = {rpc,rpcUrl:"http://127.0.0.1:1",inst:bank.inst,directory,role:"reviewer",submit:true,
      feed:bank.feed,source:bank.source}; // No key: accidental new signing must fail the test.
    const pending = await walletTick(options,bank.owner,bank.receipts());
    assert.equal("outcomes" in pending && pending.outcomes[0].action,"refund");
    assert.equal("outcomes" in pending && pending.outcomes[0].result,"pending");
    await withJournal(join(directory,"wallets"),bank.a.dividend_account,async journal => {
      const review = (journal.state as ReviewedLedger).reviews![bank.receiptKey];
      assert.equal(review.amount,"0"); assert.equal(review.verificationVersion,VERIFICATION_VERSION);
    });
    await withJournal(join(directory,"settlements"),bank.receiptKey,async journal => {
      assert.equal(journal.state?.pending?.wire,"old-clear-bytes");
    });
    resolved = true;
    const recovered = await walletTick(options,bank.owner,bank.receipts());
    assert.equal("outcomes" in recovered && recovered.outcomes[0].result,"reconciled");
    await withJournal(join(directory,"settlements"),bank.receiptKey,async journal => {assert.equal(journal.state?.pending,null);});
    const previousReads = reads;
    // Following pass rereads consent/receipt rather than using the old clear.
    bank.consent.enabled = false; options.submit = false;
    const following = await walletTick(options,bank.owner,outcome === "finalized" ? [] : bank.receipts());
    assert.ok(reads > previousReads);
    assert.ok("outcomes" in following);
    assert.equal(following.outcomes.length,outcome === "finalized" ? 0 : 1);
    if(outcome !== "finalized") assert.equal(following.outcomes[0].action,"refund");
    assert.equal(bank.wires.length,0);
  });
}

test("independent reviewer cannot approve a collector reward when its own holder amount disagrees", async t => {
  const bank = await holdingBank(), directory = await mkdtemp(join(tmpdir(),"hold-row-disagreement-"));
  t.after(() => rm(directory,{recursive:true,force:true}));
  t.mock.method(Date,"now",() => bank.time()*1000);
  const options = (role:"collector"|"reviewer"):WorkerOptions => ({rpc:bank.rpc,rpcUrl:"http://127.0.0.1:1",inst:bank.inst,
    directory:join(directory,role),role,submit:false,source:bank.source,feed:bank.feed});
  await walletTick(options("collector"),bank.owner,[]); await walletTick(options("reviewer"),bank.owner,[]);
  bank.move("reward",40n);
  const collected = await walletTick(options("collector"),bank.owner,[]);
  assert.equal(collected.status,"dry_run"); assert.equal("amount" in collected && collected.amount,"40");
  bank.move("sweep",40n);
  const reviewer = options("reviewer");
  reviewer.feed = {...bank.feed,records:new Map([...bank.feed.records].map(([key,row])=>[key,{...row,amountRaw:"39"}]))};
  const result = await walletTick(reviewer,bank.owner,bank.receipts());
  assert.equal("outcomes" in result && result.outcomes[0].action,"refund");
  await withJournal(join(directory,"reviewer","wallets"),bank.a.dividend_account,async journal => {
    assert.equal((journal.state as ReviewedLedger).reviews![bank.receiptKey].amount,"0");
  });
});

test("wallet payout eligibility uses finalized consent time, never the API publication timestamp", async t => {
  for(const timing of ["before", "missing", "at", "after"] as const) {
    const bank = await holdingBank(), directory = await mkdtemp(join(tmpdir(),"hold-consent-time-"));
    t.after(() => rm(directory,{recursive:true,force:true}));
    t.mock.method(Date,"now",()=>bank.time()*1000);
    const options:WorkerOptions = {rpc:bank.rpc,rpcUrl:"http://127.0.0.1:1",inst:bank.inst,directory,
      role:"collector",submit:false,source:bank.source,feed:bank.feed};
    await walletTick(options,bank.owner,[]);
    const transaction = bank.move("reward",40n), consentTime = Number(bank.consent.started_at);
    transaction.blockTime = timing === "missing" ? null : consentTime + (timing === "before" ? -1 : timing === "after" ? 1 : 0);
    // Delayed publication metadata cannot make a pre-consent transfer eligible,
    // nor is a valid post-consent receipt excluded by an API timestamp alone.
    const publicationOffset = timing === "before" || timing === "missing" ? 86400 : -86400;
    for(const row of bank.feed.records.values()) row.createdAt = new Date((consentTime+publicationOffset)*1000).toISOString();
    const result = await walletTick(options,bank.owner,[]);
    assert.equal(result.status,timing === "at" || timing === "after" ? "dry_run" : "idle");
    await withJournal(join(directory,"wallets"),bank.a.dividend_account,async journal=> {
      assert.equal(journal.state!.eligible,timing === "at" || timing === "after" ? "40" : "0");
    });
    t.mock.restoreAll();
  }
});

for (const role of ["collector", "reviewer"] as const) {
  test(`${role} preserves missing-payout history and replays later spending exactly once`, async t => {
    const bank = await holdingBank(), directory = await mkdtemp(join(tmpdir(), "hold-late-row-"));
    t.after(() => rm(directory, {recursive: true, force: true}));
    t.mock.method(Date, "now", () => bank.time() * 1000);
    const options: WorkerOptions = {rpc: bank.rpc, rpcUrl: "http://127.0.0.1:1", inst: bank.inst,
      directory, role, submit: false, source: bank.source, feed: bank.feed};
    const tick = () => walletTick(options, bank.owner, []);
    const state = () => withJournal(join(directory, "wallets"), bank.a.dividend_account,
      async journal => structuredClone(journal.state));
    await tick(); const original = await state();
    bank.move("reward", 40n); const rows = new Map(bank.feed.records); bank.feed.records.clear();
    assert.equal((await tick()).status, "awaiting_payout"); assert.deepEqual(await state(), {...original, payoutWaitUntil: Number(bank.consent.started_at) + 1 + 6 * 3600, payoutWaitStartedAt: Number(bank.consent.started_at) + 1});
    bank.move("spend", 25n); bank.move("buy", 25n);
    assert.equal((await tick()).status, "awaiting_payout"); assert.deepEqual(await state(), {...original, payoutWaitUntil: Number(bank.consent.started_at) + 1 + 6 * 3600, payoutWaitStartedAt: Number(bank.consent.started_at) + 1});
    for (const [key, row] of rows) bank.feed.records.set(key, row);
    const recovered = await tick();
    assert.equal(recovered.status, role === "collector" ? "dry_run" : "reviewed");
    assert.equal((await state())!.eligible, "15");
    await tick(); assert.equal((await state())!.eligible, "15");
    assert.equal(bank.wires.length, 0);
  });
}

test("reviewer missing-row wait reconciles pending settlements and leaves refunds available", async t => {
  const bank = await holdingBank(), directory = await mkdtemp(join(tmpdir(), "hold-late-row-refund-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  t.mock.method(Date, "now", () => bank.time() * 1000);
  let finalized = false, allowRefund = false;
  const reviewerKey = await testKey(directory, "reviewer", 94);
  bank.policy.reviewer = reviewerKey.address;
  const server = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body); assert.equal(request.method, "getLatestBlockhash");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({jsonrpc: "2.0", id: request.id, result: {context: {slot: 100}, value: {
      blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1000,
    }}}));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())));
  const rpc: WorkerOptions["rpc"] = async <T,>(method: string, params: unknown[]) => {
    if (method === "getSignatureStatuses") return {value: [finalized ? {confirmationStatus: "finalized", err: null} : null]} as T;
    if (method === "getBlockHeight") return 100 as T;
    if (method === "sendTransaction" && !allowRefund) throw new Error("No new settlement during evidence wait");
    return bank.rpc<T>(method, params);
  };
  const options: WorkerOptions = {rpc, rpcUrl: "http://127.0.0.1:1", inst: bank.inst, directory,
    role: "reviewer", submit: true, source: bank.source, feed: bank.feed}; // No signing key on purpose.
  await walletTick(options, bank.owner, []);
  bank.move("reward", 40n); bank.move("sweep", 40n); bank.feed.records.clear();
  const original = await withJournal(join(directory, "wallets"), bank.a.dividend_account, async j => structuredClone(j.state));
  await withJournal(join(directory, "settlements"), bank.receiptKey, async journal => {
    await journal.save({...boundary(bank.receiptKey, 0, null, "0"), pending: {
      wire: "already-signed", signature: "old-settlement", amount: "40", nonce: "0", expiresAt: bank.time()+100,
      lastValidBlockHeight: "200", evidenceHash: "a".repeat(64),
    }}, "Prior settlement");
  });
  const waiting = await walletTick(options, bank.owner, bank.receipts());
  assert.equal(waiting.status, "awaiting_payout");
  assert.equal("outcomes" in waiting && waiting.outcomes[0].result, "pending");
  finalized = true;
  const reconciled = await walletTick(options, bank.owner, bank.receipts());
  assert.equal("outcomes" in reconciled && reconciled.outcomes[0].result, "reconciled");
  const stillWaiting = await walletTick(options, bank.owner, bank.receipts());
  assert.equal("outcomes" in stillWaiting && stillWaiting.outcomes[0].result, "waiting_for_payout");
  await withJournal(join(directory, "wallets"), bank.a.dividend_account, async j => assert.deepEqual(j.state, {...original, payoutWaitUntil: Number(bank.consent.started_at) + 1 + 6 * 3600, payoutWaitStartedAt: Number(bank.consent.started_at) + 2}));
  bank.consent.enabled = false; options.submit = false;
  const refund = await walletTick(options, bank.owner, bank.receipts());
  assert.equal(refund.status, "awaiting_payout");
  assert.equal("outcomes" in refund && refund.outcomes[0].action, "refund");
  assert.equal(bank.wires.length, 0);
  allowRefund = true; options.submit = true; options.keyFile = reviewerKey.path;
  options.rpcUrl = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  const submitted = await walletTick(options, bank.owner, bank.receipts());
  assert.equal(submitted.status, "awaiting_payout");
  assert.equal("outcomes" in submitted && submitted.outcomes[0].action, "refund");
  assert.equal("outcomes" in submitted && submitted.outcomes[0].result, "submitted");
  assert.equal(bank.wires.length, 1);
});

for (const role of ["collector", "reviewer"] as const) {
  test(`${role} durable batch deadline prevents newer missing payouts starving history after restart`, async t => {
    const bank = await holdingBank(), directory = await mkdtemp(join(tmpdir(), "hold-payout-deadline-"));
    t.after(() => rm(directory, {recursive: true, force: true}));
    t.mock.method(Date, "now", () => bank.time() * 1000);
    const options: WorkerOptions = {rpc: bank.rpc, rpcUrl: "http://127.0.0.1:1", inst: bank.inst,
      directory, role, submit: false, source: bank.source, feed: bank.feed};
    const tick = () => walletTick({...options}, bank.owner, []); // Reopens durable journal every invocation.
    await tick();
    bank.move("reward", 40n); bank.feed.records.clear();
    const first = await tick(); assert.equal(first.status, "awaiting_payout");
    assert.ok("retryUntil" in first && first.retryUntil !== undefined); const deadline = first.retryUntil;
    bank.advance(3 * 3600); bank.move("reward", 20n); bank.feed.records.clear();
    const next = await tick(); assert.equal(next.status, "awaiting_payout");
    assert.equal("retryUntil" in next && next.retryUntil, deadline);
    assert.equal("waitSeconds" in next && next.waitSeconds, 3 * 3600 + 1);
    assert.equal("waitStartedAt" in next && next.waitStartedAt, Number(bank.consent.started_at) + 1);
    bank.advance(deadline - bank.time());
    // A fresh missing row cannot restart the six-hour clock for this held batch.
    bank.move("reward", 10n); bank.feed.records.clear();
    bank.move("reward", 5n); // A correct present row is still eligible.
    const finished = await tick();
    assert.equal(finished.status, role === "collector" ? "dry_run" : "reviewed");
    await withJournal(join(directory, "wallets"), bank.a.dividend_account, async journal => {
      assert.equal(journal.state!.eligible, "5");
      assert.equal(journal.state!.payoutWaitUntil, undefined);
      assert.equal(journal.state!.cursor, [...bank.feed.records.values()][0].signature);
    });
    bank.move("reward", 3n); bank.feed.records.clear();
    const fresh = await tick(); assert.equal(fresh.status, "awaiting_payout");
    assert.ok("retryUntil" in fresh && fresh.retryUntil !== undefined && fresh.retryUntil > deadline);
    assert.equal(bank.wires.length, 0);
  });
}


test("a missing API row for a pre-consent transfer does not hold the wallet", async t => {
  const bank = await holdingBank(), directory = await mkdtemp(join(tmpdir(), "hold-preconsent-missing-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  t.mock.method(Date, "now", () => bank.time() * 1000);
  const options: WorkerOptions = {rpc: bank.rpc, rpcUrl: "http://127.0.0.1:1", inst: bank.inst,
    directory, role: "collector", submit: false, source: bank.source, feed: bank.feed};
  await walletTick(options, bank.owner, []);
  const tx = bank.move("reward", 40n); tx.blockTime = Number(bank.consent.started_at) - 1;
  bank.feed.records.clear();
  assert.equal((await walletTick(options, bank.owner, [])).status, "idle");
  await withJournal(join(directory, "wallets"), bank.a.dividend_account, async journal => {
    assert.equal(journal.state!.eligible, "0"); assert.equal(journal.state!.payoutWaitUntil, undefined);
  });
});


test("endowment counts and refreshes that only read the PUMP account keep earned eligibility", async t => {
  const bank = await holdingBank(), directory = await mkdtemp(join(tmpdir(), "hold-readonly-reference-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  t.mock.method(Date, "now", () => bank.time() * 1000);
  const seen: import("../lib/reporter/types.ts").Observation[] = [];
  const options: WorkerOptions = {rpc: bank.rpc, rpcUrl: "http://127.0.0.1:1", inst: bank.inst,
    directory, role: "collector", submit: false, source: bank.source, feed: bank.feed,
    observe: event => { if (event.kind === "observations") seen.push(...event.observations); }};
  assert.equal((await walletTick(options, bank.owner, [])).status, "boundary");
  bank.reference(); bank.move("reward", 40n); bank.reference(); bank.reference();
  const next = await walletTick(options, bank.owner, []);
  assert.equal(next.status, "dry_run");
  assert.equal("amount" in next && next.amount, "40");
  assert.deepEqual(seen.map(o => o.kind), ["reward"]);
});

test("a writable listing without token balances still resets eligibility", async t => {
  const bank = await holdingBank(), directory = await mkdtemp(join(tmpdir(), "hold-writable-reference-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  t.mock.method(Date, "now", () => bank.time() * 1000);
  const seen: import("../lib/reporter/types.ts").Observation[] = [];
  const options: WorkerOptions = {rpc: bank.rpc, rpcUrl: "http://127.0.0.1:1", inst: bank.inst,
    directory, role: "collector", submit: false, source: bank.source, feed: bank.feed,
    observe: event => { if (event.kind === "observations") seen.push(...event.observations); }};
  await walletTick(options, bank.owner, []);
  bank.move("reward", 40n); bank.reference(true);
  assert.notEqual((await walletTick(options, bank.owner, [])).status, "dry_run");
  assert.deepEqual(seen.map(o => o.kind), ["reward", "uncertain"]);
  await withJournal(join(directory, "wallets"), bank.a.dividend_account, async journal => {
    assert.equal(journal.state!.eligible, "0");
  });
});

test("old missing pre-consent payout does not report an attribution expiry", async t => {
  const bank = await holdingBank(), directory = await mkdtemp(join(tmpdir(), "hold-preconsent-expiry-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  t.mock.method(Date, "now", () => bank.time() * 1000);
  const seen: import("../lib/reporter/types.ts").Observation[] = [];
  const options: WorkerOptions = {rpc: bank.rpc, rpcUrl: "http://127.0.0.1:1", inst: bank.inst,
    directory, role: "reviewer", submit: false, source: bank.source, feed: bank.feed,
    observe: event => { if (event.kind === "observations") seen.push(...event.observations); }};
  await walletTick(options, bank.owner, []);
  const transaction = bank.move("reward", 40n); transaction.blockTime = Number(bank.consent.started_at) - 6 * 3600 - 1;
  bank.feed.records.clear();
  assert.equal((await walletTick(options, bank.owner, [])).status, "reviewed");
  assert.equal(seen.length, 1); assert.equal(seen[0].kind, "other");
  assert.equal(seen[0].payoutAttribution, undefined);
});
