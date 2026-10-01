/** Read-only estimates. None of these results authorize token transfers. */
export type DailySnapshot = {
  version: 1;
  program: string;
  config: string;
  coinMint: string;
  rewardMint: string;
  observedAt: string;
  apiGeneratedAt: string;
  slot: string;
  distributedRaw: string;
  totalSweptRaw: string;
  committedBps: number;
  lastCountAt: string;
  fundingState: string;
};

const raw = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
const timestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const states = ["enabled", "complete", "retired", "paused", "unavailable", "waiting", "stale", "routing_pending"];

export function parseSnapshot(value: unknown): DailySnapshot {
  if (!value || typeof value !== "object") throw new Error("Missing daily snapshot");
  const s = value as DailySnapshot;
  if (s.version !== 1 || ![s.program, s.config, s.coinMint, s.rewardMint].every((v) => typeof v === "string" && v.length > 0)
      || !timestamp(s.observedAt) || !timestamp(s.apiGeneratedAt)
      || ![s.slot, s.distributedRaw, s.totalSweptRaw, s.lastCountAt].every(raw)
      || !Number.isInteger(s.committedBps) || s.committedBps < 0 || s.committedBps > 10_000
      || !states.includes(s.fundingState)) throw new Error("Invalid daily snapshot");
  const apiAge = Date.parse(s.observedAt) - Date.parse(s.apiGeneratedAt);
  if (apiAge < -60_000 || apiAge > 10 * 60_000) throw new Error("Stale or future-dated StonkFun API response");
  return s;
}

export function parseDistribution(value: unknown, coinMint: string, rewardMint: string) {
  const body = value as {
    data?: { mint?: string; quote?: { mint?: string; decimals?: number }; rewards?: { distributedRaw?: unknown } };
    meta?: { generatedAt?: unknown };
  } | null;
  const amount = body?.data?.rewards?.distributedRaw;
  const generatedAt = body?.meta?.generatedAt;
  if (body?.data?.mint !== coinMint || body?.data?.quote?.mint !== rewardMint
      || body?.data?.quote?.decimals !== 6 || !raw(amount) || !timestamp(generatedAt)) {
    throw new Error("Unexpected StonkFun reward response");
  }
  return { distributedRaw: amount, apiGeneratedAt: generatedAt };
}

export type DailyReport = {
  status: "baseline" | "within_range" | "review" | "inconclusive" | "no_activity";
  from: string | null;
  to: string;
  distributedPumpRaw: string | null;
  collectedPumpRaw: string | null;
  estimatedPenisPumpRaw: string | null;
  differenceRaw: string | null;
  toleranceBps: number;
  notes: string[];
};

/** Average of the two sampled commitment percentages, not an exact entitlement. */
export function dailySanity(previous: DailySnapshot | null, current: DailySnapshot, toleranceBps = 5_000): DailyReport {
  parseSnapshot(current);
  if (!Number.isInteger(toleranceBps) || toleranceBps < 0 || toleranceBps > 10_000) throw new Error("Tolerance must be 0–10000 basis points");
  const report: DailyReport = {
    status: "baseline", from: previous?.observedAt ?? null, to: current.observedAt,
    distributedPumpRaw: null, collectedPumpRaw: null, estimatedPenisPumpRaw: null,
    differenceRaw: null, toleranceBps,
    notes: [
      "Approximate PENIS-only expectation; actual holder contributions can include PUMP from other coins.",
      "Endpoint samples cannot reveal all intraday balance, consent, pause, capacity or payout-timing changes.",
      "StonkFun eligibility rules, delayed payments and token fees can also change the observed ratio.",
      "The recorded collection total does not certify that the collected PUMP was eligible reward income.",
    ],
  };
  if (!previous) {
    report.notes.push("First snapshot saved; a second daily snapshot is needed for comparison.");
    return report;
  }
  parseSnapshot(previous);
  report.status = "inconclusive";
  if (["program", "config", "coinMint", "rewardMint"].some((key) => previous[key as keyof DailySnapshot] !== current[key as keyof DailySnapshot])) {
    report.notes.push("Endowment identity changed; totals cannot be compared.");
    return report;
  }
  const distributed = BigInt(current.distributedRaw) - BigInt(previous.distributedRaw);
  const collected = BigInt(current.totalSweptRaw) - BigInt(previous.totalSweptRaw);
  if (distributed < 0n || collected < 0n || BigInt(current.slot) < BigInt(previous.slot)) {
    report.notes.push("A cumulative counter or RPC slot moved backwards; investigate the data source.");
    return report;
  }
  report.distributedPumpRaw = distributed.toString();
  report.collectedPumpRaw = collected.toString();
  const hours = (Date.parse(current.observedAt) - Date.parse(previous.observedAt)) / 3_600_000;
  if (hours < 23 || hours > 25 || Date.parse(current.apiGeneratedAt) <= Date.parse(previous.apiGeneratedAt)) {
    report.notes.push("Missing, delayed or out-of-order daily sample; this is not a comparable daily interval.");
    return report;
  }
  if (previous.fundingState !== "enabled" || current.fundingState !== "enabled") {
    report.notes.push("Collection was not enabled at both endpoints; no full-day expectation is assigned.");
    return report;
  }
  if (previous.committedBps !== current.committedBps) report.notes.push("Commitment changed; the estimate uses the mean of the two endpoint percentages.");
  const expected = distributed * BigInt(previous.committedBps + current.committedBps) / 20_000n;
  const difference = collected - expected;
  report.estimatedPenisPumpRaw = expected.toString();
  report.differenceRaw = difference.toString();
  if (expected === 0n && collected === 0n) {
    report.status = "no_activity";
    report.notes.push("No measurable expected or recorded collection; this does not demonstrate that collection works.");
  } else {
    const magnitude = difference < 0n ? -difference : difference;
    report.status = magnitude * 10_000n > expected * BigInt(toleranceBps) ? "review" : "within_range";
    if (report.status === "review") report.notes.push("Difference exceeds the reporting tolerance; investigate without making corrective withdrawals.");
  }
  return report;
}
