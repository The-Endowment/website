import { timingSafeEqual } from "node:crypto";
import { countHealth, loadKeeper, runBuy, runCount, runRefresh, runSweeps } from "@/lib/keeper";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Constant-time comparison of a bearer token against one secret (audit L-11). */
function matches(header: string | null, secret: string | undefined) {
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

async function run(job: string) {
  const keeper = await loadKeeper();
  if (!keeper) return Response.json({ skipped: "not launched" }, { status: 503 });
  try {
    if (job === "sweep") return Response.json(await runSweeps(keeper));
    if (job === "buy") return Response.json(await runBuy(keeper));
    if (job === "count") return Response.json(await runCount(keeper));
    if (job === "refresh") return Response.json(await runRefresh(keeper));
    if (job === "health") return Response.json(await countHealth(keeper));
    return Response.json({ error: "unknown job" }, { status: 404 });
  } catch (err) {
    // Expected rejections (paused, too soon, price outside the floor) land here too.
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

// Scheduled runs (Vercel Cron or another scheduler) send GET with CRON_SECRET.
export async function GET(request: Request, ctx: RouteContext<"/api/keeper/[job]">) {
  if (!matches(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return run((await ctx.params).job);
}

// The dividend-drop webhook sends POST with its own WEBHOOK_SECRET, and may only trigger sweeps.
export async function POST(request: Request, ctx: RouteContext<"/api/keeper/[job]">) {
  const job = (await ctx.params).job;
  if (job !== "sweep" || !matches(request.headers.get("authorization"), process.env.WEBHOOK_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return run(job);
}
