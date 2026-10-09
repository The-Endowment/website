/** Independent refresher orchestration; no website custody or signing keys here. */
export function assertRefresherRoles(signer: string, roles: { refresher: string; collector: string; reviewer: string }) {
  const zero = "11111111111111111111111111111111";
  if (signer !== roles.refresher || Object.values(roles).includes(zero) ||
      new Set(Object.values(roles)).size !== 3)
    throw new Error("Refresher, collector and reviewer require distinct configured keys");
}

type JobResult = { failures?: unknown[]; refresh?: { failures?: unknown[] } | null; attests?: boolean; skipped?: string; posted?: string };
type Job = "refresh" | "count" | "post";
type Jobs = Record<Job, () => Promise<JobResult>> & { verify: () => Promise<void> };

/** Keep attempting the reward baseline even if a count fails; never call a partial pass healthy. */
export async function refresherPass(jobs: Jobs) {
  const outcomes: { job: Job; ok: boolean }[] = [];
  for (const job of ["refresh", "count", "post"] as const) {
    try {
      await jobs.verify(); // Rotation or custody mismatch stops this job before signing.
      const result = await jobs[job]();
      outcomes.push({ job, ok: result.attests !== false && !result.failures?.length && !result.refresh?.failures?.length });
    } catch {
      // Provider exceptions can contain credential-bearing URLs.
      outcomes.push({ job, ok: false });
    }
  }
  return { ok: outcomes.every(o => o.ok), outcomes };
}
