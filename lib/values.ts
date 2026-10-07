/**
 * Dollar estimates at today's prices, from Jupiter. Display only; nothing
 * here feeds a buy, a collection or a reward post.
 */
import { PENIS_MINT, PUMP_MINT } from "./endowment.ts";

export const priceUrl = (mints: string[]) => `https://lite-api.jup.ag/price/v3?ids=${mints.join(",")}`;

/** USD per whole token, or null when the feed had no usable price. */
export type Prices = { penisUsd: number | null; pumpUsd: number | null };
export type Values = Prices & { kind: "ready"; observedAt: number };

function usdPrice(body: unknown, mint: string): number | null {
  const price = (body as Record<string, { usdPrice?: unknown } | undefined> | null)?.[mint]?.usdPrice;
  return typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null;
}

export function parsePrices(body: unknown): Prices {
  return { penisUsd: usdPrice(body, PENIS_MINT), pumpUsd: usdPrice(body, PUMP_MINT) };
}

/** A failed feed hides the dollar figures, nothing else. */
export async function readPrices(): Promise<Prices> {
  try {
    const response = await fetch(priceUrl([PENIS_MINT, PUMP_MINT]), { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return { penisUsd: null, pumpUsd: null };
    return parsePrices(await response.json());
  } catch {
    return { penisUsd: null, pumpUsd: null };
  }
}

/** "$779,000" style: whole dollars, rounded to three significant figures above $1,000. */
export function usdFromDollars(dollars: number): string | null {
  if (!Number.isFinite(dollars) || dollars <= 0) return null;
  const rounded = dollars >= 1_000 ? Number(dollars.toPrecision(3)) : Math.round(dollars);
  return `$${rounded.toLocaleString("en-US")}`;
}

/** The same, for an amount in base units (6 decimals) at `price` per whole token. */
export function usdEstimate(baseUnits: string, price: number | null): string | null {
  if (price === null) return null;
  return usdFromDollars(Number(BigInt(baseUnits) / 1_000n) / 1_000 * price);
}
