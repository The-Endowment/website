import { timingSafeEqual } from "node:crypto";
import { jsonRpc } from "@/lib/reporter/rpc";
import { flagshipInstance, RPC_URL } from "@/lib/solana";
import { assessWatch, readWatch } from "@/lib/watch";

// For an external uptime monitor: 200 when nothing needs attention, 503 with
// issue codes when something does (or the chain can't be read). The monitor
// URL carries WATCH_SECRET as `?key=`, so strangers can't spend our RPC quota.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function authorized(given: string | null) {
  const secret = process.env.WATCH_SECRET;
  if (!secret || !given) return false;
  const [a, b] = [Buffer.from(given), Buffer.from(secret)];
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorized(new URL(request.url).searchParams.get("key"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const now = Math.floor(Date.now() / 1000);
  try {
    const inst = await flagshipInstance();
    if (!inst) return Response.json({ ok: false, issues: [{ code: "not_configured" }] }, { status: 503 });
    const rpc = jsonRpc(process.env.SOLANA_RPC_URL ?? RPC_URL);
    const issues = assessWatch(await readWatch(rpc, inst, now));
    return Response.json({ ok: issues.length === 0, checkedAt: now, issues }, { status: issues.length ? 503 : 200 });
  } catch {
    // RPC exceptions may contain provider credentials. Return only the issue code.
    return Response.json({ ok: false, checkedAt: now, issues: [{ code: "read_failed" }] }, { status: 503 });
  }
}
