import { FLAGSHIP_CREATOR } from "@/lib/endowment";
import { flagshipInstance, RPC_URL } from "@/lib/solana";
import { jsonRpc } from "@/lib/reporter/rpc";
import { readProgress } from "@/lib/progress-read";
import type { Progress } from "@/lib/progress";

// Shared five-minute snapshot, not one RPC call per visitor. The browser also
// expires old snapshots; ISR may serve old data while it regenerates.
export const dynamic = "force-static";
export const revalidate = 300;

export async function GET() {
  let data: Progress;
  try {
    const inst = await flagshipInstance();
    data = inst && FLAGSHIP_CREATOR
      ? await readProgress(jsonRpc(RPC_URL), inst, FLAGSHIP_CREATOR, Math.floor(Date.now() / 1000))
      : { kind: "unconfigured" };
  } catch {
    data = { kind: "unavailable" };
  }
  return Response.json(data);
}
