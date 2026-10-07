import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeJson, type HealthReport } from "./operations-health.ts";

type DeliveryState = { fingerprint: string; deliveredAt: number; retryAt: number; failures: number };
/** Payloads contain fixed issue codes, never exception messages, RPC URLs or webhook credentials. */
export async function deliverAlert(directory: string, report: HealthReport, endpoint?: string,
  request: typeof fetch = fetch, now = Date.now()): Promise<"disabled" | "quiet" | "delivered" | "failed"> {
  if (!endpoint) return "disabled";
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Alert webhook must use HTTPS without URL user credentials");
  const fingerprint = createHash("sha256").update(JSON.stringify(report.issues)).digest("hex");
  let previous: DeliveryState = { fingerprint: "", deliveredAt: 0, retryAt: 0, failures: 0 };
  try { previous = JSON.parse(await readFile(join(directory, "alert-state.json"), "utf8")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Unreadable alert state"); }
  if (!previous || typeof previous.fingerprint !== "string" ||
      !/^(|[a-f0-9]{64})$/.test(previous.fingerprint) ||
      ![previous.deliveredAt, previous.retryAt, previous.failures].every((x) => Number.isSafeInteger(x) && x >= 0) ||
      previous.failures > 7) throw new Error("Invalid alert state");
  if (previous.retryAt > now || (previous.fingerprint === fingerprint &&
      (report.issues.length === 0 || now - previous.deliveredAt < 3600000))) return "quiet";
  if (report.issues.length === 0 && !previous.fingerprint) return "quiet";
  try {
    const response = await request(url, { method: "POST", redirect: "error",
      headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ event: report.issues.length ? "holding_worker_attention" : "holding_worker_recovered",
        role: report.role, at: report.finishedAt, issues: report.issues,
        owners: report.owners, pending: report.pending, failures: report.failures }) });
    if (!response.ok) throw new Error("Webhook delivery failed");
  } catch {
    const failures = Math.min(previous.failures + 1, 7);
    await writeJson(directory, "alert-state.json", { ...previous, failures,
      retryAt: now + Math.min(3600000, 30000 * 2 ** (failures - 1)) });
    return "failed";
  }
  await writeJson(directory, "alert-state.json", { fingerprint, deliveredAt: now, retryAt: 0, failures: 0 });
  return "delivered";
}
