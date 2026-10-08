import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertCollectionAllowed, collectionStopped, includesOwner, launchControls, quarantine } from "../lib/holding/operations.ts";
import { assertHeartbeatMode, completedHealthyPass, PassHealth, saveHealth } from "../lib/holding/operations-health.ts";
import { deliverAlert } from "../lib/holding/operations-alerts.ts";
import type { HoldSnapshot } from "../lib/holding/snapshot.ts";
import type { Receipt } from "../lib/holding/types.ts";
const owner = "11111111111111111111111111111111";
const other = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const snapshot = () => ({ active: true, slot: 20, config: { reserved: [1], last_count_bps: 3100,
  params: { activate_bps: 3000, deactivate_bps: 2500, allowance_margin_bps: 10000,
    max_rewards_per_day: 100n, max_buy_per_day: 10n } },
  policy: { pending: 10n, released: 20n, refunded: 5n },
}) as unknown as HoldSnapshot;

test("submit requires an explicit mode and founders require exact public-key allowlist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "holding-controls-"));
  try {
    const input = { role: "collector" as const, submit: true, stopFile: join(dir, "stop") };
    await assert.rejects(launchControls(input), /explicit|requires/);
    await assert.rejects(launchControls({ ...input, mode: "founders" }), /HOLD_FOUNDERS_FILE/);
    const foundersFile = join(dir, "founders.json");
    await writeFile(foundersFile, JSON.stringify([owner]));
    const controls = await launchControls({ ...input, mode: "founders", foundersFile });
    assert.equal(includesOwner(controls, "collector", owner), true);
    assert.equal(includesOwner(controls, "collector", other), false);
    assert.equal(includesOwner(controls, "reviewer", other), true);
    const zero = snapshot(); zero.config.params.activate_bps = 0; zero.config.params.deactivate_bps = 0;
    await assertCollectionAllowed(controls, owner, zero);
    await assert.rejects(assertCollectionAllowed(controls, other, zero), /allowlist/);
    await writeFile(foundersFile, "[]");
    await assert.rejects(launchControls({ ...input, mode: "founders", foundersFile }), /nonempty/);
  } finally { await rm(dir, { recursive: true }); }
});
test("public requires locked production thresholds and enforced 1x positive bounded allowance", async () => {
  const dir = await mkdtemp(join(tmpdir(), "holding-public-"));
  try {
    const controls = await launchControls({ role: "collector", submit: true, mode: "public", stopFile: join(dir, "stop") });
    await assertCollectionAllowed(controls, owner, snapshot());
    for (const change of [
      (s: HoldSnapshot) => { s.active = false; },
      (s: HoldSnapshot) => { s.config.reserved[0] = 0; },
      (s: HoldSnapshot) => { s.config.params.activate_bps = 0; },
      (s: HoldSnapshot) => { s.config.params.deactivate_bps = 2400; },
      (s: HoldSnapshot) => { s.config.params.allowance_margin_bps = 0; },
      (s: HoldSnapshot) => { s.config.params.max_rewards_per_day = 0n; },
      (s: HoldSnapshot) => { s.config.params.max_rewards_per_day = 101n; },
    ]) {
      const s = snapshot(); change(s);
      await assert.rejects(assertCollectionAllowed(controls, owner, s));
    }
  } finally { await rm(dir, { recursive: true }); }
});
test("quarantine persists across restarts and never clears itself", async () => {
  const dir = await mkdtemp(join(tmpdir(), "holding-stop-"));
  try {
    const stopFile = join(dir, "control", "collection.stop");
    assert.equal(await collectionStopped(stopFile), false);
    await quarantine(stopFile, "history_gap");
    await quarantine(stopFile, "different_failure");
    assert.equal(JSON.parse(await readFile(stopFile, "utf8")).code, "history_gap");
    const restarted = await launchControls({ role: "collector", submit: true, mode: "public", stopFile });
    await assert.rejects(assertCollectionAllowed(restarted, owner, snapshot()), /quarantined/);
    // Reviewer selection is never disabled by the collector's quarantine or allowlist.
    assert.equal(includesOwner(restarted, "reviewer", other), true);
    await rm(stopFile);
    await assertCollectionAllowed(restarted, owner, snapshot());
  } finally { await rm(dir, { recursive: true }); }
});
test("health reports zero-wallet dry run as inconclusive, records gaps and correct gross amounts", async () => {
  const health = new PassHealth("collector", false, "founders");
  let report = health.report();
  assert.equal(report.pilot.verdict, "not_assessed");
  assert.equal(report.pilot.nonemptyHistoryObserved, false);
  assert.ok(report.issues.includes("no_wallets_selected"));
  health.observe(owner, { kind: "snapshot", snapshot: snapshot() });
  health.observe(owner, { kind: "observations", observations: [{ signature: "tx", slot: 20,
    before: "0", after: "10", amount: "10", kind: "uncertain", reason: "missing data" }] });
  health.outcome({ status: "boundary", reason: "Observation gap: RPC credential must never enter health" });
  health.outcome({ status: "dry_run", amount: "8" });
  health.receipts([{ receipt: { amount: 5n, collected_at: 1n } as Receipt }], 259201);
  report = health.report();
  assert.equal(report.chain?.grossCollected, "35");
  assert.equal(report.amounts.proposedThisPass, "8");
  assert.ok(report.issues.includes("history_gap"));
  assert.ok(report.issues.includes("uncertain_history"));
  assert.ok(report.issues.includes("pending_over_72h"));
  assert.ok(report.issues.includes("pending_over_30h"));
  assert.equal(JSON.stringify(report).includes("credential"), false);
  assert.equal(report.feed.completeCoverageProven, false);
  const dir = await mkdtemp(join(tmpdir(), "holding-health-"));
  try {
    await saveHealth(dir, report);
    assert.deepEqual(JSON.parse(await readFile(join(dir, "health.json"), "utf8")), report);
    assert.equal((await readFile(join(dir, "health.ndjson"), "utf8")).trim().split("\n").length, 1);
  } finally { await rm(dir, { recursive: true }); }
});
test("webhook alerts are optional, deduplicated, retried and do not expose credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "holding-alert-"));
  try {
    const report = new PassHealth("reviewer", false).report();
    let requests = 0; let failed = true;
    const request = (async (_url: unknown, options: RequestInit) => {
      requests++;
      assert.equal(String(options.body).includes("secret"), false);
      if (failed) throw new Error("Provider URL https://private/?secret=credential");
      return new Response("", { status: 200 });
    }) as typeof fetch;
    assert.equal(await deliverAlert(dir, report, undefined, request), "disabled");
    assert.equal(requests, 0);
    await assert.rejects(deliverAlert(dir, report, "http://example.com", request), /HTTPS/);
    await assert.rejects(deliverAlert(dir, report, "https://user:secret@example.com", request), /credentials/);
    const endpoint = "https://example.com/hook?token=secret";
    assert.equal(await deliverAlert(dir, report, endpoint, request, 1000), "failed");
    assert.equal(await deliverAlert(dir, report, endpoint, request, 2000), "quiet");
    failed = false;
    assert.equal(await deliverAlert(dir, report, endpoint, request, 32000), "delivered");
    assert.equal(await deliverAlert(dir, report, endpoint, request, 33000), "quiet");
    assert.equal(requests, 2);
    const clear = { ...report, issues: [] };
    assert.equal(await deliverAlert(dir, clear, endpoint, request, 34000), "delivered");
    assert.equal(await deliverAlert(dir, clear, endpoint, request, 9999999), "quiet");
    assert.equal((await readFile(join(dir, "alert-state.json"), "utf8")).includes("secret"), false);
  } finally { await rm(dir, { recursive: true }); }
});

test("30-hour pending threshold signals stop before the original refund expiry, and reviewer shortfall alerts are distinct", () => {
  const early = new PassHealth("collector", true);
  const receipt = { amount: 9n, collected_at: 1n } as Receipt;
  early.receipts([{ receipt }], 30 * 3600);
  assert.equal(early.issues.has("pending_over_30h"), false);
  const stopped = new PassHealth("collector", true);
  stopped.receipts([{ receipt }], 30 * 3600 + 1);
  assert.equal(stopped.issues.has("pending_over_30h"), true);
  assert.equal(stopped.issues.has("pending_over_72h"), false);
  const reviewer = new PassHealth("reviewer", true);
  reviewer.observe(owner, { kind: "review", receipt: "receipt", collected: "9", eligible: "4" });
  assert.ok(reviewer.issues.has("held_amount_requires_refund"));
  assert.equal(reviewer.report().reviewedShortfalls, 1);
});

test("empty history reads do not count as observed history or matched reward activity", () => {
  const health = new PassHealth("collector", false);
  health.observe(owner, { kind: "observations", observations: [] });
  let report = health.report();
  assert.equal(report.owners.historyRead, 1);
  assert.equal(report.owners.nonemptyHistory, 0);
  assert.equal(report.owners.matchedReward, 0);
  assert.equal(report.pilot.nonemptyHistoryObserved, false);
  health.observe(owner, { kind: "observations", observations: [{ signature: "ordinary", slot: 20,
    before: "0", after: "10", amount: "10", kind: "other", reason: "ordinary inflow" }] });
  report = health.report();
  assert.equal(report.owners.historyRead, 1);
  assert.equal(report.owners.nonemptyHistory, 1);
  assert.equal(report.owners.matchedReward, 0);
  assert.equal(report.pilot.nonemptyHistoryObserved, true);
  health.observe(other, { kind: "observations", observations: [{ signature: "payout", slot: 21,
    before: "0", after: "5", amount: "5", kind: "reward", reason: "matched payout" }] });
  report = health.report();
  assert.equal(report.owners.historyRead, 2);
  assert.equal(report.owners.nonemptyHistory, 2);
  assert.equal(report.owners.matchedReward, 1);
  assert.equal(report.pilot.verdict, "not_assessed");
});

test("only complete healthy passes qualify for success heartbeats; idle is not pilot validation", () => {
  const health = new PassHealth("reviewer", false);
  health.feedAvailable = true;
  const idle = health.report();
  assert.equal(completedHealthyPass(idle), true);
  assert.equal(idle.pilot.verdict, "not_assessed");
  const working = { ...idle, issues: [], owners: { ...idle.owners, selected: 1, processed: 1 } };
  assert.equal(completedHealthyPass(working), true);
  assert.equal(completedHealthyPass({ ...working, owners: { ...working.owners, processed: 0 } }), false);
  assert.equal(completedHealthyPass({ ...working, failures: 1 }), false);
  for (const issue of ["feed_unavailable", "wallet_failure", "pass_failure", "collection_quarantined",
    "history_gap", "uncertain_history", "held_amount_requires_refund", "pending_over_30h", "pending_over_72h"]) {
    assert.equal(completedHealthyPass({ ...working, issues: [issue] }), false, issue);
  }
});

test("configured worker monitors require an explicit matching observation or submission mode", () => {
  const endpoint = "https://monitor.example/private-check";
  for (const submit of [false, true]) {
    assert.doesNotThrow(() => assertHeartbeatMode({ submit }));
    for (const expectedMode of [undefined, "", "founders", "invalid-private-secret"])
      assert.throws(() => assertHeartbeatMode({ endpoint, expectedMode, submit }), /requires HOLD_HEARTBEAT_MODE/);
    assert.throws(() => assertHeartbeatMode({ endpoint, expectedMode: submit ? "observe" : "submit", submit }), /does not match/);
    assert.doesNotThrow(() => assertHeartbeatMode({ endpoint, expectedMode: submit ? "submit" : "observe", submit }));
  }
});
