import { keeperConfig, runBuy, runCount, runSweeps } from "@/lib/keeper";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Chance a scheduled tick actually buys, so buys land at unpredictable times. */
const BUY_CHANCE = 0.5;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(request: Request, job: string) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const cfg = keeperConfig();
  if (!cfg) return Response.json({ skipped: "not launched" }, { status: 503 });

  try {
    if (job === "sweep") return Response.json(await runSweeps(cfg));
    if (job === "count") return Response.json(await runCount(cfg));
    if (job === "buy") {
      if (Math.random() > BUY_CHANCE) return Response.json({ skipped: "random skip" });
      return Response.json(await runBuy(cfg));
    }
    return Response.json({ error: "unknown job" }, { status: 404 });
  } catch (err) {
    // Expected rejections (paused, too soon, price outside the floor) land here too.
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

// Vercel Cron sends GET; the Helius webhook for dividend drops sends POST.
export async function GET(request: Request, ctx: RouteContext<"/api/keeper/[job]">) {
  return handle(request, (await ctx.params).job);
}

export async function POST(request: Request, ctx: RouteContext<"/api/keeper/[job]">) {
  return handle(request, (await ctx.params).job);
}
