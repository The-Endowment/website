import "server-only";
import { PENIS_MINT } from "@/lib/site";

export type HolderRewards = {
  /** PUMP paid to $PENIS holders since launch, in whole tokens. */
  distributed: number;
  /** Wallets that have received a payout. */
  holders: number;
};

/** stonk.fun's public running total for $PENIS. Null when the API is unavailable, so the page can skip the figures. */
export async function loadHolderRewards(): Promise<HolderRewards | null> {
  try {
    const res = await fetch(`https://www.stonkfun.xyz/api/public/v1/tokens/${PENIS_MINT}/rewards`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: { mint?: string; rewards?: { distributedTokens?: unknown; holderCount?: unknown } };
    };
    const r = body.data?.rewards;
    if (body.data?.mint !== PENIS_MINT || typeof r?.distributedTokens !== "number" || typeof r?.holderCount !== "number") {
      return null;
    }
    return { distributed: r.distributedTokens, holders: r.holderCount };
  } catch {
    return null;
  }
}
