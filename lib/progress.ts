/** Public display data only. No wallet permissions or collection decisions. */
export const ENDOWMENT_GOAL = 200_000_000n * 1_000_000n;
export const SNAPSHOT_MAX_AGE = 10 * 60;
export const COUNT_INTERVAL = 86_400;
export const COUNT_MAX_AGE = 3 * COUNT_INTERVAL;

export type ProgressSnapshot = {
  kind: "ready";
  observedAt: number;
  slot: number;
  config: string;
  vault: string;
  /** Spendable PENIS in the principal vault, in base units. Excludes LP and pending PUMP. */
  held: string;
  committed: string;
  committedBps: number;
  lastCountAt: number;
  active: boolean;
  pausedUntil: number;
  retired: boolean;
  milestoneReached: boolean;
};
export type Progress = { kind: "unconfigured" | "unavailable" } | ProgressSnapshot;

export function progressState(data: Progress | null, now: number) {
  if (!data) return "loading";
  if (data.kind !== "ready") return data.kind;
  if (now - data.observedAt > SNAPSHOT_MAX_AGE || data.observedAt > now + 120) return "unavailable";
  if (data.milestoneReached || BigInt(data.held) >= ENDOWMENT_GOAL) return "complete";
  if (data.retired) return "retired";
  if (data.pausedUntil > now) return "paused";
  if (!data.lastCountAt) return "uncounted";
  if (now - data.lastCountAt > COUNT_MAX_AGE) return "stale";
  return data.active ? "active" : "raising";
}

/** Clamp only the visual bar; never cap the displayed vault balance. */
export function goalPercent(held: string) {
  return Math.min(100, Number(BigInt(held) * 10_000n / ENDOWMENT_GOAL) / 100);
}

export function wholeTokens(baseUnits: string) {
  return (BigInt(baseUnits) / 1_000_000n).toLocaleString("en-US");
}

export function percent(bps: number) {
  return `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}
