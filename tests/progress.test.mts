import assert from "node:assert/strict";
import { test } from "node:test";
import { holdingBank } from "./support/holding-bank.mts";
import { readProgress } from "../lib/progress-read.ts";
import { ENDOWMENT_GOAL, COUNT_MAX_AGE, SNAPSHOT_MAX_AGE, goalPercent, progressState, wholeTokens, type ProgressSnapshot } from "../lib/progress.ts";
import type { RpcCall } from "../lib/reporter/rpc.ts";

type Bank = { context: { slot: number }; value: ({ owner: string; data: [string, string] } | null)[] };
async function scenario() {
  const b = await holdingBank();
  b.config.contribution_cap = ENDOWMENT_GOAL;
  b.config.params.activate_bps = 3000;
  b.config.params.deactivate_bps = 2500;
  b.config.reserved[0] = 1;
  b.config.last_count_bps = 2800;
  b.config.last_committed = 280_000_000_000_000n;
  // These deliberately exceed the target: none is the principal vault balance.
  b.config.total_coin_bought = 400_000_000_000_000n;
  b.config.total_liquidity_coin = 210_000_000_000_000n;
  b.policy.pending = 900_000_000_000_000n;
  const calls: { method: string; params: unknown[] }[] = [];
  const rpc: RpcCall = async <T,>(method: string, params: unknown[]) => {
    calls.push({ method, params });
    const bank = await b.rpc<Bank>(method, params);
    const principal = bank.value[1]!;
    const bytes = Buffer.from(principal.data[0], "base64");
    bytes.writeBigUInt64LE(50_000_000_000_000n, 64);
    bank.value[1] = { ...principal, data: [bytes.toString("base64"), "base64"] };
    return bank as T;
  };
  return { b, rpc, calls, read: () => readProgress(rpc, b.inst, b.config.creator, b.time()) };
}

test("progress counts only finalized principal, not purchases, liquidity, pledges or pending PUMP", async () => {
  const { b, calls, read } = await scenario();
  const data = await read();
  assert.equal(data.held, "50000000000000");
  assert.equal(goalPercent(data.held), 25);
  assert.equal(data.committedBps, 2800);
  assert.equal(data.committed, "280000000000000");
  assert.equal(progressState(data, b.time()), "active"); // 28% sustains a previously active endowment.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "getMultipleAccounts");
  assert.equal((calls[0].params[0] as string[]).length, 3);
  assert.deepEqual(calls[0].params[1], { encoding: "base64", commitment: "finalized" });
});

test("unexpected contract goals, identity and count timestamps are unavailable, not zero", async () => {
  const { b, read } = await scenario();
  b.config.contribution_cap = 0n;
  await assert.rejects(read, /configuration/);
  b.config.contribution_cap = ENDOWMENT_GOAL;
  b.config.params.activate_bps = 1000;
  await assert.rejects(read, /configuration/);
  b.config.params.activate_bps = 3000;
  b.config.last_count_at = BigInt(b.time() + 1);
  await assert.rejects(read, /snapshot/);
  b.config.last_count_at = BigInt(b.time());
  b.config.coin_mint = b.inst.dividendMint;
  await assert.rejects(read, /configuration/);
});

test("snapshot rejects missing accounts, wrong ownership, wrong mint, truncated data and stale RPC clocks", async () => {
  const { b, rpc } = await scenario();
  for (const corrupt of [
    (r: Bank) => { r.value[1] = null; },
    (r: Bank) => { r.value[1]!.owner = b.inst.program; },
    (r: Bank) => { const bytes = Buffer.from(r.value[1]!.data[0], "base64"); bytes.fill(0, 0, 32); r.value[1]!.data[0] = bytes.toString("base64"); },
    (r: Bank) => { r.value[1]!.data[0] = "AA=="; },
  ]) {
    const broken: RpcCall = async <T,>(method: string, params: unknown[]) => {
      const bank = structuredClone(await rpc<Bank>(method, params)); corrupt(bank); return bank as T;
    };
    await assert.rejects(() => readProgress(broken, b.inst, b.config.creator, b.time()));
  }
  await assert.rejects(() => readProgress(rpc, b.inst, b.config.creator, b.time() + 121), /snapshot/);
});

test("status respects goal, retirement, pauses, unfinished counts, hysteresis and stale counts", async () => {
  const { b, read } = await scenario();
  const data = await read(), now = b.time();
  const state = (change: Partial<ProgressSnapshot>) => progressState({ ...data, ...change }, now);
  assert.equal(state({ active: false, committedBps: 2800 }), "raising");
  assert.equal(state({ active: true, committedBps: 2800 }), "active");
  assert.equal(state({ pausedUntil: now + 1 }), "paused");
  assert.equal(state({ retired: true }), "retired");
  assert.equal(state({ lastCountAt: 0 }), "uncounted");
  assert.equal(state({ lastCountAt: now - COUNT_MAX_AGE }), "active");
  assert.equal(state({ lastCountAt: now - COUNT_MAX_AGE - 1 }), "stale");
  assert.equal(state({ held: ENDOWMENT_GOAL.toString() }), "complete");
  assert.equal(state({ milestoneReached: true, held: "0" }), "complete");
  assert.equal(progressState(data, now + SNAPSHOT_MAX_AGE + 1), "unavailable");
  assert.equal(progressState({ kind: "unconfigured" }, now), "unconfigured");
  assert.equal(progressState({ kind: "unavailable" }, now), "unavailable");
});

test("zero is distinct from missing data and balances above the goal stay accurate", async () => {
  const { b, read } = await scenario();
  const data = await read();
  assert.equal(progressState({ ...data, held: "0" }, b.time()), "active");
  assert.equal(goalPercent("0"), 0);
  assert.equal(goalPercent((ENDOWMENT_GOAL + 1n).toString()), 100);
  assert.equal(wholeTokens("250000001999999"), "250,000,001");
});

test("founders mode is explicit and never masquerades as public participation", async () => {
  const { b, read } = await scenario();
  b.config.params.activate_bps = 0;
  b.config.params.deactivate_bps = 0;
  b.config.reserved[0] = 0;
  const data = await read();
  assert.equal(data.launchMode, "founders");
  assert.equal(progressState(data, b.time()), "founders");
  assert.equal(progressState({ ...data, pausedUntil: Number((1n << 63n) - 1n) }, b.time()), "paused");
  b.config.reserved[0] = 1;
  await assert.rejects(read, /configuration/);
  b.config.reserved[0] = 0;
  b.config.version = 3;
  await assert.rejects(read, /configuration/);
});
