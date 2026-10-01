import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";
import { readFile } from "node:fs/promises";
import type { Prepared } from "../reporter/types.ts";
export async function keySigner(path: string | undefined) {
  if (!path) throw new Error("A key file is required for submission");
  const key = JSON.parse(await readFile(path, "utf8"));
  if (
    !Array.isArray(key) ||
    key.length !== 64 ||
    !key.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)
  )
    throw new Error("Invalid signer key");
  return createKeyPairSignerFromBytes(Uint8Array.from(key));
}
export async function prepare(
  rpcUrl: string,
  signer: TransactionSigner,
  ixs: Instruction[],
  slot: number,
  fields: Pick<Prepared, "nonce" | "amount" | "expiresAt" | "evidenceHash">,
): Promise<Prepared> {
  const rpc = createSolanaRpc(rpcUrl);
  const { value: blockhash } = await rpc
    .getLatestBlockhash({
      commitment: "finalized",
      minContextSlot: BigInt(slot),
    })
    .send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) =>
      appendTransactionMessageInstructions(
        [getSetComputeUnitLimitInstruction({ units: 350000 }), ...ixs],
        m,
      ),
  );
  const signed = await signTransactionMessageWithSigners(message);
  return {
    ...fields,
    wire: getBase64EncodedWireTransaction(signed),
    signature: getSignatureFromTransaction(signed),
    lastValidBlockHeight: blockhash.lastValidBlockHeight.toString(),
  };
}
