/**
 * Launch parameter files for scripts/launch.mts: parsing, and the contract's
 * own validation rules (`Params::validate` in state.rs), so a bad file fails
 * here rather than in a signed transaction.
 */
import { address } from "@solana/kit";
import type { Params } from "./holding/accounts.ts";

const U64 = ["max_buy_per_tx", "max_buy_per_day", "min_buy_amount", "min_buy_interval_secs", "max_rewards_per_day"] as const;
const SMALL = ["max_price_impact_bps", "max_twap_deviation_bps", "tip_bps", "buy_bps", "activate_bps", "deactivate_bps", "min_stake_bps", "allowance_margin_bps"] as const;

/** u64 fields as decimal strings (base units), small fields as numbers, refresher as an address. */
export function parseParams(raw: Record<string, unknown>): Params {
  const out: Record<string, unknown> = {};
  for (const k of U64) {
    const v = raw[k];
    if (typeof v !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(v)) throw new Error(`${k} must be a decimal string of base units`);
    out[k] = BigInt(v);
  }
  for (const k of SMALL) {
    const v = raw[k];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 65_535) throw new Error(`${k} must be a whole number`);
    out[k] = v;
  }
  if (typeof raw.refresher !== "string") throw new Error("refresher must be an address");
  out.refresher = address(raw.refresher);
  const unknown = Object.keys(raw).filter((k) => !(k in out));
  if (unknown.length) throw new Error(`Unknown fields: ${unknown.join(", ")}`);
  return out as Params;
}

/** The v4 rules this script enforces before signing. The program checks them again. */
export function checkLaunchParams(p: Params, { creating }: { creating: boolean }) {
  const founders = p.activate_bps === 0 && p.deactivate_bps === 0;
  const pub = p.activate_bps === 3000 && p.deactivate_bps === 2500;
  if (!founders && !pub) throw new Error("Thresholds must be 0/0 (founders' test) or 3000/2500 (public)");
  if (creating && pub) throw new Error("Create in founders mode (0/0); go public later with propose-params");
  if (p.allowance_margin_bps !== 10_000) throw new Error("allowance_margin_bps must be exactly 10000 (1.0x)");
  if (p.max_rewards_per_day === 0n || p.max_rewards_per_day > p.max_buy_per_day * 10n) {
    throw new Error("max_rewards_per_day must be positive and at most 10x max_buy_per_day");
  }
  if (p.max_buy_per_tx === 0n || p.max_buy_per_tx > p.max_buy_per_day) {
    throw new Error("max_buy_per_tx must be positive and at most max_buy_per_day");
  }
  if (p.min_buy_amount > p.max_buy_per_tx) throw new Error("min_buy_amount must be at most max_buy_per_tx");
  // MIN/MAX_PRICE_IMPACT_BPS, MIN/MAX_TWAP_DEVIATION_BPS, MIN_BUY_INTERVAL_BOUNDS, MAX_TIP_BPS, MAX_MIN_STAKE_BPS.
  if (p.max_price_impact_bps < 10 || p.max_price_impact_bps > 300) throw new Error("max_price_impact_bps must be 10-300");
  if (p.max_twap_deviation_bps < 100 || p.max_twap_deviation_bps > 1_000) throw new Error("max_twap_deviation_bps must be 100-1000");
  if (p.min_buy_interval_secs < 60n || p.min_buy_interval_secs > 86_400n) throw new Error("min_buy_interval_secs must be 60-86400");
  if (p.tip_bps > 50) throw new Error("tip_bps must be at most 50");
  if (p.min_stake_bps > 500) throw new Error("min_stake_bps must be at most 500");
  if (p.buy_bps !== 10_000) throw new Error("buy_bps must be 10000: v1 spends everything on buys");
  if (p.refresher === "11111111111111111111111111111111") throw new Error("Set the refresher address explicitly");
}
