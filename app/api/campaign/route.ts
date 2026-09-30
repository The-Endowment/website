import { loadCampaign } from "@/lib/campaign";

// Built once and regenerated at most every five minutes, like the ledger: the
// query string can't bypass it, and it reads only the public RPC.
export const dynamic = "force-static";
export const revalidate = 300;

/** The home page campaign: commitment, landlords, and (once live) totals and recent buys. */
export async function GET() {
  try {
    return Response.json(await loadCampaign());
  } catch {
    return Response.json({ launched: false });
  }
}
