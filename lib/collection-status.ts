/**
 * What to tell people about collection, from the config alone. `config.active`
 * is only the threshold flag: it is true from creation in the founders' test
 * (0 >= 0) and stays true through a pause, so it can't be shown as "on" by itself.
 */
import { ACTIVE_MAX_AGE_SECS, type EndowmentConfig } from "./endowment.ts";

export type CollectionStatus = "closed" | "paused" | "founders" | "on" | "count-due" | "building";

type Fields = Pick<EndowmentConfig, "active" | "pausedUntil" | "retired" | "milestoneReached" | "lastCountAt" | "reserved" | "params">;

export function collectionStatus(config: Fields, now: number): CollectionStatus {
  if (config.retired || config.milestoneReached) return "closed";
  if (BigInt(now) < config.pausedUntil) return "paused";
  if (config.params.activateBps === 0 && config.reserved[0] === 0) return "founders";
  if (!config.active) return "building";
  return config.lastCountAt > 0n && Number(config.lastCountAt) <= now &&
    now - Number(config.lastCountAt) <= ACTIVE_MAX_AGE_SECS ? "on" : "count-due";
}
