export type MonitoredRole = "collector" | "reviewer" | "refresher";
export type HeartbeatDelivery = "disabled" | "delivered" | "failed";

/** One independent Healthchecks-compatible check per role. Only completed passes
 * ping success; an external deadline detects a stopped or hung process. Delivery
 * failure is reported, never thrown after a pass may already have moved funds. */
export async function deliverHeartbeat(input: {
  endpoint?: string;
  role: MonitoredRole;
  success: boolean;
}, request: typeof fetch = fetch): Promise<HeartbeatDelivery> {
  if (!input.endpoint) return "disabled";
  try {
    const url = new URL(input.endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.hash)
      return "failed";
    if (!input.success) url.pathname = url.pathname.replace(/\/$/, "") + "/fail";
    const response = await request(url, {
      method: "POST", redirect: "error", cache: "no-store",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ role: input.role, result: input.success ? "completed" : "failed" }),
    });
    return response.ok ? "delivered" : "failed";
  } catch {
    // Never log endpoint credentials, provider errors, response bodies or wallet data.
    return "failed";
  }
}
