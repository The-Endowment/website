import type { Address } from "@solana/kit";
import {
  base64ToBytes,
  type EndowmentConfig,
  type Instance,
} from "../endowment.ts";
import { fetchReporterPolicy } from "../reward-client.ts";
import { holdPda } from "./client.ts";
import { decodeAccount } from "./codec.ts";
import type { Policy } from "./types.ts";
export async function collectionServiceReady(
  rpc: unknown,
  inst: Instance,
  config: EndowmentConfig,
): Promise<boolean> {
  if (!config.holding) {
    const p = await fetchReporterPolicy(rpc, inst);
    return Boolean(p && !p.disabled);
  }
  type Reader = {
    getAccountInfo: (
      key: Address,
      options: unknown,
    ) => {
      send: () => Promise<{
        value: { owner: Address; data: [string, string] } | null;
      }>;
    };
  };
  const { value } = await (rpc as Reader)
    .getAccountInfo(await holdPda(inst, "policy"), {
      encoding: "base64",
      commitment: "finalized",
    })
    .send();
  if (!value || value.owner !== inst.program || value.data[1] !== "base64")
    return false;
  const policy = decodeAccount<Policy>(
    "CollectionPolicy",
    base64ToBytes(value.data[0]),
  );
  return policy.config === inst.config && policy.collector !== policy.reviewer;
}
