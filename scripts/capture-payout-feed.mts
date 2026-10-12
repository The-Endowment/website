import { resolve } from "node:path";
import { archiveFeed } from "../lib/holding/feed.ts";
import { bindRoleDirectory } from "../lib/holding/directory.ts";
import { deliverHeartbeat } from "../lib/operations-heartbeat.ts";

// A separate one-shot service: no RPC, signing key or wallet traversal. Schedule
// every 30–60 seconds on each role's host, independently of holding:once.
const role = process.argv.find((a) => a.startsWith("--role="))?.split("=")[1];
if (role !== "collector" && role !== "reviewer") {
  console.error("Use --role=collector or --role=reviewer");
  process.exitCode = 1;
} else {
  let success = false;
  try {
    if (!process.env.HOLD_DATA_DIR) throw new Error("Missing durable directory");
    const directory = resolve(process.env.HOLD_DATA_DIR);
    await bindRoleDirectory(directory, role);
    const feed = await archiveFeed(directory);
    success = true;
    console.log(JSON.stringify({ role, capture: "completed", archivedRecords: feed.size,
      completeCoverageProven: false }));
  } catch {
    // Archive errors may contain provider URLs or response bodies; keep logs fixed.
    console.error("Payout capture failed; inspect archive freshness, gap state, feed lock and provider status. Collection must remain stopped until reviewed.");
    process.exitCode = 1;
  }
  const endpoint = role === "collector" ? process.env.HOLD_COLLECTOR_FEED_HEARTBEAT_URL
    : process.env.HOLD_REVIEWER_FEED_HEARTBEAT_URL;
  const heartbeat = await deliverHeartbeat({ endpoint, role: `${role}-feed`, success });
  if (heartbeat === "failed") {
    console.error("Payout capture heartbeat delivery failed; check the independent monitor.");
    process.exitCode = 1;
  }
  console.log(JSON.stringify({ role: `${role}-feed`, heartbeat }));
}
