import { readPrices, type Values } from "@/lib/values";

// One shared ten-minute price snapshot, not a feed call per visitor.
export const dynamic = "force-static";
export const revalidate = 600;

export async function GET() {
  const values: Values = { kind: "ready", ...(await readPrices()), observedAt: Math.floor(Date.now() / 1000) };
  return Response.json(values);
}
