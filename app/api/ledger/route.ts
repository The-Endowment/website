import { loadLedger } from "@/lib/ledger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The latest finished count, per landlord. Cached at the edge for five minutes. */
export async function GET() {
  try {
    const ledger = await loadLedger();
    return Response.json(ledger, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch {
    return Response.json({ launched: false }, { headers: { "Cache-Control": "public, s-maxage=60" } });
  }
}
