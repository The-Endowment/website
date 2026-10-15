import { readFile } from "node:fs/promises";
import { verifyRecovery } from "../lib/holding/recovery.ts";

// Read-only. Usage:
//   node scripts/verify-payout-recovery.mts --floor=2026-10-14T00:00:00Z \
//     NEW/payout-feed.json OLD/payout-feed.json OLD/payout-history-pending.json
// The first file is the rebuilt archive; the rest are what it replaces.
const floor = process.argv.find((a) => a.startsWith("--floor="))?.slice("--floor=".length);
const [rebuilt, ...old] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!floor || !rebuilt || old.length === 0) {
  console.error("Usage: --floor=<ISO time> <rebuilt archive> <old archive or checkpoint>...");
  process.exitCode = 2;
} else {
  const load = async (path: string) => JSON.parse(await readFile(path, "utf8"));
  const result = verifyRecovery(await load(rebuilt),
    await Promise.all(old.map(async (name) => ({ name, value: await load(name) }))), floor);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
