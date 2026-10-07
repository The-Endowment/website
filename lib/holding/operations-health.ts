import { open, rename } from "node:fs/promises";
import { join } from "node:path";
import type { Observation } from "../reporter/types.ts";
import type { HoldSnapshot } from "./snapshot.ts";
import type { Receipt } from "./types.ts";

export type WorkerEvent = { kind: "snapshot"; snapshot: HoldSnapshot } |
  { kind: "observations"; observations: Observation[] } |
  { kind: "review"; receipt: string; collected: string; eligible: string };
export class PassHealth {
  readonly startedAt = new Date().toISOString();
  readonly issues = new Set<string>();
  readonly statuses: Record<string, number> = {};
  readonly observations = { reward: 0, outflow: 0, other: 0, failed: 0, uncertain: 0 };
  private observedOwners = new Set<string>();
  private nonemptyHistoryOwners = new Set<string>();
  private matchedRewardOwners = new Set<string>();
  private activeOwners = new Set<string>();
  private latest?: HoldSnapshot;
  ownersDiscovered = 0;
  ownersSelected = 0;
  ownersProcessed = 0;
  failures = 0;
  feedRecords = 0;
  feedAvailable = false;
  reviewedShortfalls = 0;
  pendingCount = 0;
  pendingAmount = "0";
  oldestPendingSeconds = 0;
  proposedAmount = 0n;
  submittedAmount = 0n;

  readonly role: "collector" | "reviewer";
  readonly submit: boolean;
  readonly mode?: string;
  constructor(role: "collector" | "reviewer", submit: boolean, mode?: string) {
    this.role = role; this.submit = submit; this.mode = mode;
  }
  observe(owner: string, event: WorkerEvent) {
    if (event.kind === "snapshot") {
      this.latest = event.snapshot;
      if (event.snapshot.active) this.activeOwners.add(owner);
    } else if (event.kind === "review") {
      if (BigInt(event.eligible) < BigInt(event.collected)) {
        this.reviewedShortfalls++;
        this.issues.add("held_amount_requires_refund");
      }
    } else {
      this.observedOwners.add(owner);
      if (event.observations.length > 0) this.nonemptyHistoryOwners.add(owner);
      for (const o of event.observations) {
        this.observations[o.kind]++;
        if (o.kind === "reward") this.matchedRewardOwners.add(owner);
        if (o.kind === "uncertain") this.issues.add("uncertain_history");
      }
    }
  }
  receipts(receipts: { receipt: Receipt }[], now = Math.floor(Date.now() / 1000)) {
    this.pendingCount = receipts.length;
    this.pendingAmount = receipts.reduce((sum, { receipt }) => sum + receipt.amount, 0n).toString();
    for (const { receipt } of receipts) {
      const age = Math.max(0, now - Number(receipt.collected_at));
      this.oldestPendingSeconds = Math.max(age, this.oldestPendingSeconds);
      // Config v4 keeps refund expiry fixed even during an incident stop.
      if (age >= 30 * 3600) this.issues.add("pending_over_30h");
      if (age >= 72 * 3600) this.issues.add("pending_over_72h");
    }
  }
  outcome(result: { status: string; reason?: string; amount?: string }) {
    this.ownersProcessed++;
    this.statuses[result.status] = (this.statuses[result.status] ?? 0) + 1;
    if (result.reason?.startsWith("Observation gap:")) this.issues.add("history_gap");
    if (result.status === "dry_run" && result.amount) this.proposedAmount += BigInt(result.amount);
    if (result.status === "submitted" && result.amount) this.submittedAmount += BigInt(result.amount);
  }
  failure(code = "wallet_failure") { this.failures++; this.issues.add(code); }
  report() {
    if (this.ownersSelected === 0) this.issues.add("no_wallets_selected");
    if (!this.feedAvailable) this.issues.add("feed_unavailable");
    const s = this.latest;
    return {
      version: 1, role: this.role, mode: this.mode ?? "observation", submit: this.submit,
      startedAt: this.startedAt, finishedAt: new Date().toISOString(),
      issues: [...this.issues].sort(), failures: this.failures,
      owners: { discovered: this.ownersDiscovered, selected: this.ownersSelected,
        processed: this.ownersProcessed, activeObserved: this.activeOwners.size,
        historyRead: this.observedOwners.size, nonemptyHistory: this.nonemptyHistoryOwners.size,
        matchedReward: this.matchedRewardOwners.size },
      feed: { available: this.feedAvailable, archivedRecords: this.feedRecords,
        completeCoverageProven: false },
      observations: this.observations, statuses: this.statuses, reviewedShortfalls: this.reviewedShortfalls,
      amounts: { proposedThisPass: this.proposedAmount.toString(), submittedThisPass: this.submittedAmount.toString(),
        note: "Base units. Repeated dry-run proposals overlap; never sum across passes. Submitted is not finalized." },
      pending: { countAtStart: this.pendingCount, amountAtStart: this.pendingAmount,
        oldestSecondsAtStart: this.oldestPendingSeconds },
      chain: s ? { slot: s.slot, countBps: s.config.last_count_bps,
        pending: s.policy.pending.toString(), released: s.policy.released.toString(), refunded: s.policy.refunded.toString(),
        grossCollected: (s.policy.pending + s.policy.released + s.policy.refunded).toString() } : null,
      pilot: { verdict: "not_assessed", nonemptyHistoryObserved: this.nonemptyHistoryOwners.size > 0,
        note: "A read-only pass does not test transactions, refunds or recovery, and cannot establish complete feed coverage." },
    };
  }
}
export type HealthReport = ReturnType<PassHealth["report"]>;

export async function writeJson(directory: string, name: string, value: unknown) {
  const path = join(directory, name);
  const file = await open(path + ".tmp", "w", 0o600);
  try { await file.writeFile(JSON.stringify(value) + "\n"); await file.sync(); }
  finally { await file.close(); }
  await rename(path + ".tmp", path);
  const dir = await open(directory, "r");
  try { await dir.sync(); } finally { await dir.close(); }
}
export async function saveHealth(directory: string, report: HealthReport) {
  await writeJson(directory, "health.json", report);
  const log = await open(join(directory, "health.ndjson"), "a", 0o600);
  try { await log.writeFile(JSON.stringify(report) + "\n"); await log.sync(); }
  finally { await log.close(); }
}
