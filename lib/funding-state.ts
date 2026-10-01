import type { EndowmentConfig } from "./endowment";
import { COLLECTION_PENDING_NOTICE } from "./collection-policy.ts";

/** Match the contract's ACTIVE_MAX_AGE_SECS. */
export const ACTIVE_MAX_AGE_SECS = 3 * 24 * 60 * 60;

export type FundingState = "complete" | "retired" | "paused" | "unavailable" | "waiting" | "stale" | "routing_pending" | "enabled";
type FundingConfig = Pick<EndowmentConfig, "milestoneReached" | "retired" | "pausedUntil" | "contributionCap" | "active" | "lastCountAt"> & {
  params: Pick<EndowmentConfig["params"], "activateBps">;
};

/** Lifecycle plus the application hold pending a reviewed reward-routing implementation. */
export function fundingState(config: FundingConfig, directBalance: bigint | null, now: number): FundingState {
  if (config.milestoneReached || (directBalance !== null && directBalance >= config.contributionCap)) return "complete";
  if (config.retired) return "retired";
  if (now < Number(config.pausedUntil)) return "paused";
  if (directBalance === null) return "unavailable";
  if (!config.active) return "waiting";
  if (config.params.activateBps > 0 && now - Number(config.lastCountAt) > ACTIVE_MAX_AGE_SECS) return "stale";
  return "routing_pending";
}

export const fundingStatus: Record<FundingState, string> = {
  complete: "Funding complete. Holder contributions have ended permanently.",
  retired: "Holder contributions have ended: the endowment is retired.",
  paused: "Holder contributions are paused.",
  unavailable: "The vault balance is unavailable. Contribution status cannot be verified.",
  waiting: "Waiting for enough eligible commitment before holder contributions can run.",
  stale: "Holder contributions are paused until a fresh commitment count completes.",
  enabled: "Holder contributions are enabled, subject to market and token checks.",
  routing_pending: COLLECTION_PENDING_NOTICE,
};
