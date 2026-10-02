/** What a connected wallet needs to see about its own collections: whether
 * collection is switched on for it, and what is being held for it right now.
 * Browser-safe: two batched account reads, no program-wide scan. */
import type { Address } from "@solana/kit";
import { base64ToBytes, type Instance } from "../endowment.ts";
import { holdPda } from "./client.ts";
import { decodeAccount } from "./codec.ts";
import type { Consent, Policy, Receipt } from "./types.ts";

/** How many of a wallet's most recent collections are checked. A collection is
 * settled within days, so the pending ones are always among these. */
export const RECENT_COLLECTIONS = 40;

type Info = { owner: string; data: [string, string] } | null;
type RpcLike = {
  getMultipleAccounts: (
    addresses: Address[],
    config: { encoding: "base64" },
  ) => { send: () => Promise<{ value: readonly Info[] }> };
};

export type Holding = {
  /** The endowment's collection is set up (its collector and reviewer are named). */
  ready: boolean;
  /** This wallet's collection switch; null before it first joins. */
  consent: Consent | null;
  /** Collections held for this wallet, oldest first. */
  receipts: Receipt[];
};

function decode<T>(name: string, info: Info, program: Address): T | null {
  if (!info || info.owner !== program) return null;
  try {
    return decodeAccount<T>(name, base64ToBytes(info.data[0]));
  } catch {
    return null;
  }
}

export async function loadHolding(rpc: unknown, inst: Instance, owner: Address): Promise<Holding> {
  const read = (addresses: Address[]) => (rpc as RpcLike).getMultipleAccounts(addresses, { encoding: "base64" }).send();
  const first = await read([await holdPda(inst, "policy"), await holdPda(inst, "consent", owner)]);
  const policy = decode<Policy>("CollectionPolicy", first.value[0], inst.program);
  const found = decode<Consent>("CollectionConsent", first.value[1], inst.program);
  const consent = found && found.owner === owner && found.config === inst.config ? found : null;
  const ready = policy?.config === inst.config;
  if (!consent || consent.next_nonce === BigInt(0)) return { ready, consent, receipts: [] };

  const last = consent.next_nonce - BigInt(1);
  const from = last >= BigInt(RECENT_COLLECTIONS) ? last - BigInt(RECENT_COLLECTIONS - 1) : BigInt(0);
  const nonces: bigint[] = [];
  for (let n = from; n <= last; n++) nonces.push(n);
  const keys = await Promise.all(nonces.map((n) => holdPda(inst, "receipt", owner, n)));
  const infos = await read(keys);
  const receipts = nonces.flatMap((nonce, i) => {
    const receipt = decode<Receipt>("PendingCollection", infos.value[i], inst.program);
    return receipt && receipt.owner === owner && receipt.config === inst.config && receipt.nonce === nonce ? [receipt] : [];
  });
  return { ready, consent, receipts };
}
