import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRewardTotal, rewardPostDecision, REWARD_POST_INTERVAL_SECS } from "../lib/reward-total.ts";
import { postRewardTotalIx, settleIx, MEMO_PROGRAM } from "../lib/holding/client.ts";
import { schema } from "../lib/holding/codec.ts";
import fixture from "./fixtures/holding-chain.json" with { type: "json" };
import { address, type TransactionSigner } from "@solana/kit";
import type { Instance } from "../lib/endowment.ts";
import type { Receipt } from "../lib/holding/types.ts";

const COIN = "JE3HT7SbCgXDQWV6xp3oiiAisDzq4HyZ8wyEVBDCs45Z", PUMP = "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn";
const body = (over: Record<string, unknown> = {}, raw: unknown = "120677465569351") => ({
  data: { mint: COIN, quote: { mint: PUMP, decimals: 6 }, rewards: { distributedRaw: raw, distributedTokens: 120677465.569351 }, ...over },
});

test("the reward total is read in base units from the feed's exact string", () => {
  assert.equal(parseRewardTotal(body(), COIN, PUMP), 120677465569351n);
  assert.equal(parseRewardTotal(body({}, "0"), COIN, PUMP), 0n);
});

test("a response for another coin, another token or a malformed amount is refused", () => {
  assert.throws(() => parseRewardTotal(body({ mint: PUMP }), COIN, PUMP), /another coin/);
  assert.throws(() => parseRewardTotal(body({ quote: { mint: COIN } }), COIN, PUMP), /another token/);
  for (const raw of [120677465569351, "12.5", "-1", "", "012", null, "1e9", "9".repeat(21)]) {
    assert.throws(() => parseRewardTotal(body({}, raw), COIN, PUMP), /malformed/);
  }
  assert.throws(() => parseRewardTotal(body({}, "18446744073709551616"), COIN, PUMP), /out of range/);
  assert.throws(() => parseRewardTotal({}, COIN, PUMP));
  assert.throws(() => parseRewardTotal(null, COIN, PUMP));
});

test("a post goes out once a day, never with the allowance off or a total that went down", () => {
  const state = { allowanceMarginBps: 10_000, lastRewardTotal: 500n, lastRewardPostAt: 1_000_000n };
  const due = 1_000_000 + REWARD_POST_INTERVAL_SECS;
  assert.deepEqual(rewardPostDecision(state, 600n, due), { post: true });
  // A flat total still posts: it keeps the daily rhythm the carry-over marks rely on.
  assert.deepEqual(rewardPostDecision(state, 500n, due), { post: true });
  assert.equal(rewardPostDecision(state, 600n, due - 1).post, false);
  assert.match((rewardPostDecision(state, 499n, due) as { skipped: string }).skipped, /below/);
  assert.match((rewardPostDecision({ ...state, allowanceMarginBps: 0 }, 600n, due) as { skipped: string }).skipped, /off/);
  // The very first post only sets the starting point, so it goes at once.
  assert.deepEqual(rewardPostDecision({ ...state, lastRewardTotal: 0n, lastRewardPostAt: 0n }, 600n, 5), { post: true });
});

const inst: Instance = {
  program: address(fixture.program), config: address(fixture.config),
  coinMint: address(fixture.coinMint), dividendMint: address(fixture.dividendMint),
  coinTokenProgram: address(fixture.coinTokenProgram), dividendTokenProgram: address(fixture.dividendTokenProgram),
};
const signer = (a: string) => ({ address: address(a) }) as TransactionSigner;

test("the post instruction matches the contract: refresher signs, config is written, total is a u64", () => {
  const ix = postRewardTotalIx(inst, signer(fixture.collector), 120677465569351n);
  const def = schema.instructions.post_reward_total;
  assert.deepEqual([...ix.data!.slice(0, 8)], def.discriminator);
  assert.equal(new DataView(Uint8Array.from(ix.data!.slice(8)).buffer).getBigUint64(0, true), 120677465569351n);
  assert.equal(ix.data!.length, 16);
  assert.deepEqual(ix.accounts!.map((a) => a.address), [fixture.collector, fixture.config, fixture.coinMint]);
  assert.deepEqual(def.accounts.map((a) => [a.name, Boolean(a.signer), Boolean(a.writable)]),
    [["refresher", true, false], ["config", false, true], ["coin_mint", false, false]]);
});

test("every settlement passes the Memo program last, read-only", async () => {
  const receipt = { config: inst.config, owner: address(fixture.owner), payer: address(fixture.collector), nonce: 0n } as Receipt;
  for (const release of [true, false]) {
    const ix = await settleIx(inst, receipt, signer(fixture.owner), release);
    const named = schema.instructions[release ? "release_collection" : "refund_collection"].accounts.length;
    assert.equal(ix.accounts.length, named + 1);
    assert.equal(ix.accounts[named].address, MEMO_PROGRAM);
    assert.equal(ix.accounts[named].role, 0);
  }
});
