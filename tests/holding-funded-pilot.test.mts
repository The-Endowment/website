import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTokenDecoder, getTokenEncoder } from "@solana-program/token-2022";
import { holdSnapshot } from "../lib/holding/snapshot.ts";
import { walletTick, type WorkerOptions } from "../lib/holding/worker.ts";
import { PassHealth } from "../lib/holding/operations-health.ts";
import { withJournal } from "../lib/reporter/journal.ts";
import type { RpcCall } from "../lib/reporter/rpc.ts";
import type { ReviewedLedger } from "../lib/holding/reconcile.ts";
import { holdingBank } from "./support/holding-bank.mts";

const PUMP = 1_000_000n;
const CAP = 1_000n * PUMP;
type Bank = Awaited<ReturnType<typeof holdingBank>>;

/** Keep the fixture's canonical owner/mint/delegate, replacing only its allowance. */
function cappedRpc(bank: Bank): RpcCall {
  return (async (method: string, params: unknown[]) => {
    const result = await bank.rpc(method, params);
    if (method !== "getMultipleAccounts") return result;
    const response = structuredClone(result) as {
      value: ({ owner: string; data: string[] } | null)[];
    };
    const index = (params[0] as string[]).indexOf(bank.a.dividend_account);
    if (index < 0) return result;
    const account = response.value[index]!;
    const token = getTokenDecoder().decode(Buffer.from(account.data[0], "base64"));
    account.data[0] = Buffer.from(getTokenEncoder().encode({ ...token, delegatedAmount: CAP })).toString("base64");
    return response;
  }) as RpcCall;
}

function rewardCapacity(bank: Bank) {
  bank.landlord.counted_amount = 10_000n * PUMP;
  bank.landlord.snapshot = 10_000n * PUMP;
  bank.config.params.max_buy_per_day = 10_000n * PUMP;
  bank.config.params.max_buy_per_tx = 10_000n * PUMP;
  bank.config.params.max_rewards_per_day = 10_000n * PUMP;
}

test("a 1,000 PUMP delegation bounds an existing allowance, but an invalidated refresh leaves none", async t => {
  const bank = await holdingBank();
  t.mock.method(Date, "now", () => bank.time() * 1000);
  rewardCapacity(bank);
  bank.move("reward", 2_000n * PUMP);
  const rpc = cappedRpc(bank);
  assert.equal((await holdSnapshot(rpc, bank.inst, bank.owner)).allowance, CAP.toString());

  // Model the account state written by legacy refresh_landlords when
  // delegated_amount < MIN_DELEGATION. This fixture does not execute Rust.
  bank.landlord.snapshot = 0n;
  bank.landlord.snapshot_valid = false;
  bank.landlord.attestations = 0;
  assert.equal((await holdSnapshot(rpc, bank.inst, bank.owner)).allowance, "0");
});

for (const type of ["approve", "approveChecked"] as const) {
  test(`${type} to the same endowment delegate clears eligibility and prevents a positive review`, async t => {
    const bank = await holdingBank(), directory = await mkdtemp(join(tmpdir(), "hold-capped-approval-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    t.mock.method(Date, "now", () => bank.time() * 1000);
    rewardCapacity(bank);
    const health = new PassHealth("collector", false, "founders");
    let rpc = bank.rpc;
    const options = (role: "collector" | "reviewer"): WorkerOptions => ({
      rpc, rpcUrl: "http://127.0.0.1:1", inst: bank.inst,
      directory: join(directory, role), role, submit: false, source: bank.source, feed: bank.feed,
      observe: event => { if (role === "collector") health.observe(bank.owner, event); },
    });
    await walletTick(options("collector"), bank.owner, []);
    await walletTick(options("reviewer"), bank.owner, []);
    const reward = bank.move("reward", 2_000n * PUMP);
    const candidate = await walletTick(options("collector"), bank.owner, []);
    assert.equal(candidate.status, "dry_run");
    assert.equal("amount" in candidate && candidate.amount, (2_000n * PUMP).toString());
    await walletTick(options("reviewer"), bank.owner, []);

    // Owner signs only a smaller approval; no PUMP moves and the delegate stays
    // the canonical authority. Even this explicit case is uncertain today.
    const approval = bank.reference(true);
    rpc = cappedRpc(bank);
    approval.transaction.message.accountKeys = [
      { pubkey: bank.a.dividend_account, signer: false, writable: true },
      { pubkey: bank.owner, signer: true, writable: true },
      { pubkey: bank.a.authority, signer: false, writable: false },
      { pubkey: bank.inst.dividendMint, signer: false, writable: false },
      { pubkey: bank.inst.dividendTokenProgram, signer: false, writable: false },
    ];
    approval.transaction.message.instructions = [{ programId: bank.inst.dividendTokenProgram,
      parsed: { type, info: { source: bank.a.dividend_account, owner: bank.owner, delegate: bank.a.authority,
        ...(type === "approve" ? { amount: CAP.toString() } : {
          mint: bank.inst.dividendMint, tokenAmount: { amount: CAP.toString(), decimals: 6 },
        }),
      } },
    }];
    approval.meta!.preTokenBalances = structuredClone(reward.meta!.postTokenBalances);
    approval.meta!.postTokenBalances = structuredClone(reward.meta!.postTokenBalances);
    const result = await walletTick(options("collector"), bank.owner, []);
    assert.equal(result.status, "idle");
    assert.ok(health.report().issues.includes("uncertain_history"));
    assert.equal(health.historyStop(), true);
    await withJournal(join(directory, "collector", "wallets"), bank.a.dividend_account, async journal => {
      assert.equal(journal.state!.eligible, "0");
    });

    // If another sender ignored the stop, the independent reviewer would still
    // lack reward eligibility for that receipt and choose a full refund.
    bank.move("sweep", CAP);
    const review = await walletTick(options("reviewer"), bank.owner, bank.receipts());
    assert.equal("outcomes" in review && review.outcomes[0].action, "refund");
    await withJournal(join(directory, "reviewer", "wallets"), bank.a.dividend_account, async journal => {
      assert.equal((journal.state as ReviewedLedger).reviews![bank.receiptKey].amount, "0");
    });
    assert.equal(bank.wires.length, 0);
  });
}
