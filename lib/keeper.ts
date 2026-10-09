import "server-only";
import { createKeyPairSignerFromBytes, createSolanaRpc } from "@solana/kit";
import { decodeConfig, fetchDecoded } from "./endowment";
import { flagshipInstance } from "./solana";
import type { Keeper } from "./keeper-runtime";
export { countHealth, runBuy, runPrune, runSweeps } from "./keeper-runtime";

/** Website custody is limited to a fee-paying crank, never the refresher. */
export async function loadKeeper(): Promise<Keeper | null> {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const secret = process.env.KEEPER_SECRET_KEY;
  const inst = await flagshipInstance();
  if (!rpcUrl || !secret || !inst) return null;
  const rpc = createSolanaRpc(rpcUrl);
  const signer = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(secret)));
  const config = await fetchDecoded(rpc, inst.config, decodeConfig);
  if (!config || signer.address === config.params.refresher)
    throw new Error("Website keeper must be separate from the refresher");
  return { rpc, signer, inst, drawSecret: "unused-by-web-keeper",
    priorityMicroLamports: BigInt(process.env.KEEPER_PRIORITY_MICROLAMPORTS ?? 5000) };
}
