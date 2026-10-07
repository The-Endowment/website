/**
 * The independent watch: a read-only check of the live endowment that any
 * external uptime monitor can poll (`/api/watch`). It needs no key and signs
 * nothing, so it keeps working when the keeper, collector or reviewer is down.
 * An issue list that isn't empty means someone should look.
 */
import { address, type Address } from "@solana/kit";
import type { Instance } from "./endowment.ts";
import type { RpcCall } from "./reporter/rpc.ts";
import { holdPda } from "./holding/client.ts";
import { decodeAccount } from "./holding/codec.ts";
import { accountBytes, pendingReceipts } from "./holding/snapshot.ts";
import type { Config, Policy } from "./holding/types.ts";

/** Matches the collector's own stop: six hours past the 24-hour minimum hold. */
export const RECEIPT_OVERDUE_SECS = 30 * 60 * 60;
/** At 72 hours a collection is refund-only; still being there means refunds are stuck. */
export const RECEIPT_EXPIRED_SECS = 72 * 60 * 60;
/** Matches REWARD_POST_STALE_SECS: without a daily post nothing can be collected. */
export const REWARD_POST_STALE_SECS = 36 * 60 * 60;
/** Two missed daily counts. */
export const COUNT_STALE_SECS = 2 * 24 * 60 * 60;
/** Roughly a few hundred transactions of fees. */
export const LOW_FEE_LAMPORTS = 50_000_000n;

const NONE = "11111111111111111111111111111111";

export type WatchRole = "collector" | "reviewer" | "refresher";

export type WatchInput = {
  now: number;
  paused: boolean;
  closed: boolean;
  landlords: number;
  lastCountAt: number;
  lastRewardPostAt: number;
  receipts: { collectedAt: number; amount: bigint }[];
  balances: { role: WatchRole; address: string; lamports: bigint }[];
};

export type WatchIssue =
  | { code: "paused" }
  | { code: "receipt_overdue" | "receipt_stuck"; count: number; amount: string; oldestHours: number }
  | { code: "reward_post_stale" | "count_stale"; ageHours: number | null }
  | { code: "low_fee_balance"; role: WatchRole; address: string; sol: number };

const hours = (secs: number) => Math.floor(secs / 3600);

/** Pure: everything the watch flags, from one read of the chain. */
export function assessWatch(w: WatchInput): WatchIssue[] {
  const issues: WatchIssue[] = [];
  if (w.paused) issues.push({ code: "paused" });
  for (const [code, limit] of [["receipt_stuck", RECEIPT_EXPIRED_SECS], ["receipt_overdue", RECEIPT_OVERDUE_SECS]] as const) {
    const late = w.receipts.filter((r) => w.now - r.collectedAt >= limit);
    if (late.length === 0) continue;
    issues.push({
      code, count: late.length,
      amount: late.reduce((sum, r) => sum + r.amount, 0n).toString(),
      oldestHours: hours(w.now - Math.min(...late.map((r) => r.collectedAt))),
    });
    break; // Stuck receipts are also overdue; report the worse once.
  }
  // Daily jobs only matter while landlords are enrolled and the endowment is open.
  if (w.landlords > 0 && !w.closed) {
    const age = (t: number) => (t > 0 ? w.now - t : null);
    const post = age(w.lastRewardPostAt);
    if (post === null || post > REWARD_POST_STALE_SECS) {
      issues.push({ code: "reward_post_stale", ageHours: post === null ? null : hours(post) });
    }
    const count = age(w.lastCountAt);
    if (count === null || count > COUNT_STALE_SECS) {
      issues.push({ code: "count_stale", ageHours: count === null ? null : hours(count) });
    }
  }
  for (const b of w.balances) {
    if (b.lamports < LOW_FEE_LAMPORTS) {
      issues.push({ code: "low_fee_balance", role: b.role, address: b.address, sol: Number(b.lamports) / 1e9 });
    }
  }
  return issues;
}

type Account = { owner: string; data: [string, string] };

/** One read of config, policy, pending receipts and the three operator balances. */
export async function readWatch(rpc: RpcCall, inst: Instance, now: number): Promise<WatchInput> {
  const policyAddress = await holdPda(inst, "policy");
  const bank = await rpc<{ value: (Account | null)[] }>("getMultipleAccounts", [
    [inst.config, policyAddress], { encoding: "base64", commitment: "finalized" },
  ]);
  const config = decodeAccount<Config>("Config", accountBytes(bank.value[0], inst.program));
  const policy = decodeAccount<Policy>("CollectionPolicy", accountBytes(bank.value[1], inst.program));
  if (config.version !== 4 || policy.config !== inst.config) throw new Error("Unexpected watch accounts");
  const receipts = await pendingReceipts(rpc, inst);
  const roles: [WatchRole, Address][] = [
    ["collector", policy.collector], ["reviewer", policy.reviewer], ["refresher", address(config.params.refresher)],
  ];
  const balances = await Promise.all(roles.filter(([, a]) => a !== NONE).map(async ([role, a]) => {
    const { value } = await rpc<{ value: number }>("getBalance", [a, { commitment: "confirmed" }]);
    return { role, address: a as string, lamports: BigInt(value) };
  }));
  return {
    now,
    paused: BigInt(now) < config.paused_until,
    closed: config.retired || config.milestone_reached,
    landlords: config.landlord_count,
    lastCountAt: Number(config.last_count_at),
    lastRewardPostAt: Number(config.last_reward_post_at),
    receipts: receipts.map(({ receipt }) => ({ collectedAt: Number(receipt.collected_at), amount: receipt.amount })),
    balances,
  };
}
