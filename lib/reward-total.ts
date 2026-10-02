/**
 * The daily reward post. stonk.fun publishes a running total of the PUMP paid
 * to $PENIS holders; once a day the keeper (the endowment's refresher) posts it
 * on-chain with `post_reward_total`, and the contract turns the increase into
 * each landlord's allowance. This file holds the parts that need no key or
 * network, so they can be tested.
 */

const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);

/** Post once the last post is this old. A little under a day, so a daily schedule never skips one. */
export const REWARD_POST_INTERVAL_SECS = 23 * 60 * 60;

/** With the allowance on, the health check reports a post older than this as stale. */
export const REWARD_POST_STALE_SECS = 36 * 60 * 60;

export const rewardTotalUrl = (coinMint: string) => `https://www.stonkfun.xyz/api/public/v1/tokens/${coinMint}/rewards`;

/**
 * The cumulative total from stonk.fun's response, in PUMP base units. Throws
 * unless the response is for this coin, paid in this dividend, with a whole
 * non-negative amount that fits the contract's field.
 */
export function parseRewardTotal(body: unknown, coinMint: string, dividendMint: string): bigint {
  const data = (body as { data?: { mint?: unknown; quote?: { mint?: unknown }; rewards?: { distributedRaw?: unknown } } })?.data;
  if (data?.mint !== coinMint) throw new Error("Reward total is for another coin");
  if (data.quote?.mint !== dividendMint) throw new Error("Reward total is paid in another token");
  const raw = data.rewards?.distributedRaw;
  if (typeof raw !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(raw)) throw new Error("Reward total is missing or malformed");
  const total = BigInt(raw);
  if (total > U64_MAX) throw new Error("Reward total is out of range");
  return total;
}

type PostState = { allowanceMarginBps: number; lastRewardTotal: bigint; lastRewardPostAt: bigint };

/**
 * Whether to post `total` now, or why not. A total below the last one posted
 * is never sent: on-chain it would start the count again from the lower figure
 * and drop a day of rewards, so it waits for someone to look at the feed.
 */
export function rewardPostDecision(state: PostState, total: bigint, now: number): { post: true } | { post: false; skipped: string } {
  if (state.allowanceMarginBps === 0) return { post: false, skipped: "the reward allowance is off" };
  const age = now - Number(state.lastRewardPostAt);
  if (state.lastRewardPostAt !== BigInt(0) && age < REWARD_POST_INTERVAL_SECS) {
    return { post: false, skipped: "posted recently" };
  }
  if (total < state.lastRewardTotal) return { post: false, skipped: "the feed's total is below the last one posted" };
  return { post: true };
}
