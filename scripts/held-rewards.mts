import { mkdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { address, getBase58Decoder } from "@solana/kit";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { base64ToBytes, flagshipConfig, PROGRAM_ID, PENIS_MINT, PUMP_MINT, type Instance } from "../lib/endowment.ts";
import { jsonRpc } from "../lib/reporter/rpc.ts";
import { readArchivedFeed, assertFeedFresh } from "../lib/holding/feed.ts";
import { bindRoleDirectory } from "../lib/holding/directory.ts";
import { decodeAccount, schema } from "../lib/holding/codec.ts";
import { pendingReceipts } from "../lib/holding/snapshot.ts";
import { walletTick } from "../lib/holding/worker.ts";
import type { Consent } from "../lib/holding/types.ts";
import { HOLD_COLLECTION_RELEASED } from "../lib/holding/release.ts";
import { assertCollectionAllowed, collectionStopped, includesOwner, launchControls, quarantine } from "../lib/holding/operations.ts";
import { assertHeartbeatMode, completedHealthyPass, PassHealth, saveHealth } from "../lib/holding/operations-health.ts";
import { deliverAlert } from "../lib/holding/operations-alerts.ts";
import { deliverHeartbeat } from "../lib/operations-heartbeat.ts";

const selectedRole = process.argv.find((a) => a.startsWith("--role="))?.split("=")[1];
const heartbeatEndpoint = selectedRole === "collector"
  ? process.env.HOLD_COLLECTOR_HEARTBEAT_URL : process.env.HOLD_REVIEWER_HEARTBEAT_URL;

async function main() {
  const role = selectedRole;
  const mode = process.argv.find((a) => a.startsWith("--mode="))?.split("=")[1];
  const submit = process.argv.includes("--submit");
  if (role !== "collector" && role !== "reviewer") throw new Error("Use --role=collector or --role=reviewer");
  assertHeartbeatMode({ endpoint: heartbeatEndpoint, expectedMode: process.env.HOLD_HEARTBEAT_MODE, submit });
  if (submit && !HOLD_COLLECTION_RELEASED) throw new Error("Draft release hold: submission requires a reviewed rollout");
  const rpcUrl = process.env.SOLANA_RPC_URL, data = process.env.HOLD_DATA_DIR, config = await flagshipConfig();
  if (!rpcUrl || !data || !PROGRAM_ID || !config)
    throw new Error("Set reviewed flagship configuration, SOLANA_RPC_URL, and a durable HOLD_DATA_DIR");
  const directory = resolve(data), stopFile = resolve(process.env.HOLD_STOP_FILE ?? join(directory, "collection.stop"));
  await bindRoleDirectory(directory, role);
  const lock = join(directory, "worker.lock");
  await mkdir(lock);
  const health = new PassHealth(role, submit, mode);
  try {
    const controls = await launchControls({ role, submit, mode, stopFile, foundersFile: process.env.HOLD_FOUNDERS_FILE });
    if (role === "collector" && await collectionStopped(stopFile)) health.issues.add("collection_quarantined");
    const rpc = jsonRpc(rpcUrl);
    const inst: Instance = { program: PROGRAM_ID, config, coinMint: PENIS_MINT, dividendMint: PUMP_MINT,
      coinTokenProgram: TOKEN_2022_PROGRAM_ADDRESS, dividendTokenProgram: TOKEN_2022_PROGRAM_ADDRESS };
    const requireFreshFeed = () => assertFeedFresh(directory).catch(async () => {
      health.feedAvailable = false;
      health.issues.add("feed_unavailable");
      if (role === "collector") await quarantine(stopFile, "feed_unavailable");
      throw new Error("Payout archive no longer usable");
    });
    const loadFeed = () => readArchivedFeed(directory).then((records) => {
      health.feedAvailable = true; health.feedRecords = records.size; return records;
    }).catch(async () => {
      health.feedAvailable = false;
      health.issues.add("feed_unavailable");
      if (role === "collector") {
        await quarantine(stopFile, "feed_unavailable");
        throw new Error("Payout feed unavailable; collection quarantined");
      }
      return new Map(); // Missing evidence never blocks reviewer refunds.
    });
    const feed = await loadFeed();
    const receipts = await pendingReceipts(rpc, inst);
    health.receipts(receipts);
    if (role === "collector" && health.issues.has("pending_over_30h"))
      await quarantine(stopFile, "pending_over_30h");
    const rows = await rpc<{ account: { owner: string; data: [string, string] } }[]>("getProgramAccounts", [
      inst.program, { encoding: "base64", commitment: "finalized", filters: [
        { memcmp: { offset: 0, bytes: getBase58Decoder().decode(Uint8Array.from(schema.accounts.CollectionConsent)) } },
        { memcmp: { offset: 8, bytes: config } },
      ] },
    ]);
    const owners = new Set(receipts.map((r) => r.receipt.owner));
    for (const row of rows) {
      if (row.account.owner !== inst.program) throw new Error("Wrong consent program");
      const consent = decodeAccount<Consent>("CollectionConsent", base64ToBytes(row.account.data[0]));
      if (consent.config !== config) throw new Error("Wrong consent config");
      if (consent.enabled) owners.add(consent.owner);
    }
    const selected = [...owners].filter((owner) => includesOwner(controls, role, owner)).sort();
    health.ownersDiscovered = owners.size; health.ownersSelected = selected.length;
    for (const owner of selected) {
      try {
        const result = await walletTick({ rpc, rpcUrl, inst, directory, submit, role, feed, loadFeed,
          keyFile: process.env.HOLD_KEYPAIR_FILE,
          beforeRelease: requireFreshFeed,
          beforeCollect: async (snapshot) => {
            // Capture can fail during a long wallet pass. Recheck immediately
            // before signing and broadcast, without fetching the public feed.
            await requireFreshFeed();
            if (health.issues.has("history_gap") || health.issues.has("uncertain_history"))
              await quarantine(stopFile, "history_evidence_gap");
            await assertCollectionAllowed(controls, owner, snapshot);
          },
          observe: (event) => health.observe(owner, event),
          source: { mint: PUMP_MINT, rewardMint: PENIS_MINT, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
            authority: "HuBMeYW3aDn8BH65fo8xxbP4oiexyup8udzKyccgi8Ga", source: "J8vxiGw4gPng3JTN9HoKJs3ioCD5fnjKGDtRHPVGgaGo" },
        }, address(owner), receipts.filter((r) => r.receipt.owner === owner));
        health.outcome(result);
        if (role === "collector" && (health.issues.has("history_gap") || health.issues.has("uncertain_history")))
          await quarantine(stopFile, "history_evidence_gap");
        console.log(JSON.stringify({ role, owner, status: result.status }));
      } catch {
        health.failure(); process.exitCode = 1;
        if (role === "collector") await quarantine(stopFile, "wallet_failure");
        // Raw provider exceptions can include URLs with credentials.
        console.error(JSON.stringify({ role, owner, error: "wallet_failure", detail: "Inspect durable journal and provider status; collection remains stopped when quarantined." }));
      }
    }
  } catch {
    health.failure("pass_failure"); process.exitCode = 1;
    if (role === "collector") await quarantine(stopFile, "pass_failure");
  } finally {
    try {
      if (role === "collector" && await collectionStopped(stopFile)) health.issues.add("collection_quarantined");
      const report = health.report();
      if (!completedHealthyPass(report)) process.exitCode = 1;
      await saveHealth(directory, report);
      const alert = await deliverAlert(directory, report, process.env.HOLD_ALERT_WEBHOOK).catch(() => "failed");
      if (alert === "failed") { console.error("Alert delivery failed; inspect local health report."); process.exitCode = 1; }
      console.log(JSON.stringify({ health: report, alert }));
    } finally { await rm(lock, { recursive: true }); }
  }
}

async function run() {
  try { await main(); }
  catch {
    console.error("Worker failed before or while writing health; check configuration, lock, durable storage and external heartbeat monitor.");
    process.exitCode = 1;
  }
  // This is deliberately outside main: startup, journal, alert and lock-cleanup
  // failures must not leave a successful heartbeat behind. A killed/hung worker
  // cannot send either ping; its independent check must alert on a missed deadline.
  if (selectedRole === "collector" || selectedRole === "reviewer") {
    const heartbeat = await deliverHeartbeat({ endpoint: heartbeatEndpoint, role: selectedRole,
      success: !process.exitCode });
    if (heartbeat === "failed") {
      console.error("Heartbeat delivery failed; the completed pass was not repeated. Check the independent monitor.");
      process.exitCode = 1;
    }
    console.log(JSON.stringify({ role: selectedRole, heartbeat }));
  }
}
await run();
