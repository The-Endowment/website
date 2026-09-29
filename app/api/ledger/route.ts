import { loadLedger } from "@/lib/ledger";

// Built once and regenerated at most every five minutes (audit KW-06): the
// query string can't bypass it, and it reads only the public RPC.
export const dynamic = "force-static";
export const revalidate = 300;

/** Every landlord's record, from the landlord accounts. */
export async function GET() {
  try {
    return Response.json(await loadLedger());
  } catch {
    return Response.json({ launched: false });
  }
}
