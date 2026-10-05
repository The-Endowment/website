/** What a connected wallet needs to see about its own collections: whether
 * collection is switched on for it, and what is being held for it right now.
 * Browser-safe: one policy/consent read and one owner-filtered receipt query. */
import { getBase58Decoder, type Address } from "@solana/kit";
import { base64ToBytes, type Instance } from "../endowment.ts";
import { holdPda } from "./client.ts";
import { decodeAccount, schema } from "./codec.ts";
import type { Consent, Policy, Receipt } from "./types.ts";

type Info = { owner: string; data: [string, string] } | null;
type Response<T> = { context: { slot: bigint }; value: T };
type RpcLike = {
  getMultipleAccounts: (
    addresses: Address[],
    config: { encoding: "base64"; commitment: "confirmed" },
  ) => { send: () => Promise<Response<readonly Info[]>> };
  getProgramAccounts: (
    program: Address,
    config: {
      encoding: "base64";
      commitment: "confirmed";
      withContext: true;
      minContextSlot: bigint;
      filters: { memcmp: { offset: bigint; bytes: string; encoding: "base58" } }[];
    },
  ) => { send: () => Promise<Response<readonly { pubkey: Address; account: Info }[]>> };
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
  if (info === null) return null;
  if (!info || info.owner !== program || info.data?.[1] !== "base64")
    throw new Error(`Invalid ${name} account owner or encoding`);
  return decodeAccount<T>(name, base64ToBytes(info.data[0]));
}

function checkedValue<T>(response: Response<readonly T[]>, minSlot = 0n): readonly T[] {
  if (
    typeof response?.context?.slot !== "bigint" || response.context.slot < minSlot ||
    !Array.isArray(response.value)
  ) throw new Error("Incomplete or stale holding-account response; please retry");
  return response.value;
}

export async function loadHolding(rpc: unknown, inst: Instance, owner: Address): Promise<Holding> {
  const client = rpc as RpcLike;
  const first = await client.getMultipleAccounts(
    [await holdPda(inst, "policy"), await holdPda(inst, "consent", owner)],
    { encoding: "base64", commitment: "confirmed" },
  ).send();
  const infos = checkedValue(first);
  if (infos.length !== 2) throw new Error("Incomplete policy/consent response; please retry");
  const policy = decode<Policy>("CollectionPolicy", infos[0], inst.program);
  const consent = decode<Consent>("CollectionConsent", infos[1], inst.program);
  if (
    (policy && policy.config !== inst.config) ||
    (consent && (consent.owner !== owner || consent.config !== inst.config))
  ) throw new Error("Holding-account identity mismatch");

  // Nonces include no-op collections and settled receipts are closed. Query all
  // remaining accounts instead of assuming pending receipts have recent nonces.
  // Standard getProgramAccounts has no pagination: a provider limit must surface
  // as an error, never be converted into an empty or shortened recovery list.
  const response = await client.getProgramAccounts(inst.program, {
    encoding: "base64", commitment: "confirmed", withContext: true,
    minContextSlot: first.context.slot,
    filters: [
      { memcmp: { offset: 0n, bytes: getBase58Decoder().decode(Uint8Array.from(schema.accounts.PendingCollection)), encoding: "base58" } },
      { memcmp: { offset: 8n, bytes: inst.config, encoding: "base58" } },
      { memcmp: { offset: 40n, bytes: owner, encoding: "base58" } },
    ],
  }).send();
  const rows = checkedValue(response, first.context.slot);
  const seen = new Set<Address>();
  const receipts: Receipt[] = [];
  for (const row of rows) {
    const receipt = decode<Receipt>("PendingCollection", row?.account, inst.program);
    if (
      !receipt || receipt.owner !== owner || receipt.config !== inst.config ||
      row.pubkey !== await holdPda(inst, "receipt", owner, receipt.nonce) ||
      seen.has(row.pubkey)
    ) throw new Error("Invalid or duplicate pending contribution; please retry");
    seen.add(row.pubkey);
    receipts.push(receipt);
  }
  receipts.sort((a, b) => {
    const order = a.collected_at - b.collected_at || a.nonce - b.nonce;
    return order < 0n ? -1 : order > 0n ? 1 : 0;
  });
  return { ready: policy !== null, consent, receipts };
}
