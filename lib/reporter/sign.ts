import {
  appendTransactionMessageInstructions, createKeyPairSignerFromBytes, createSolanaRpc, createTransactionMessage,
  getBase64EncodedWireTransaction, getSignatureFromTransaction, pipe, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners, type Address,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";
import { collectRewardIx } from "../reward-client.ts";
import type { Instance } from "../endowment.ts";
import type { ChainSnapshot } from "./snapshot.ts";
import type { Prepared } from "./types.ts";

/** Only loaded for explicitly enabled submission; never in dry-run observation. */
export async function prepareCollection(rpcUrl: string, keyBytes: Uint8Array, inst: Instance, owner: Address, snapshot: ChainSnapshot, amount: bigint, evidenceHash: string): Promise<Prepared> {
  const signer = await createKeyPairSignerFromBytes(keyBytes);
  if (signer.address !== snapshot.reporter) throw new Error("Signing key is not the configured reporter");
  const rpc = createSolanaRpc(rpcUrl);
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "finalized", minContextSlot: BigInt(snapshot.slot) }).send();
  const expiresAt = snapshot.now + 90;
  const nonce = BigInt(snapshot.nonce) + 1n;
  const ix = await collectRewardIx(inst, owner, snapshot.config.pool, snapshot.pool, signer, {
    consentId: BigInt(snapshot.consentId), nonce, collectionEpoch: BigInt(snapshot.collectionEpoch), reporterEpoch: BigInt(snapshot.reporterEpoch),
    amount, expectedSourceBalance: BigInt(snapshot.balance), issuedAt: BigInt(snapshot.now), expiresAt: BigInt(expiresAt), evidenceHash: Uint8Array.from(Buffer.from(evidenceHash, "hex")),
  });
  const message = pipe(createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m), (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions([getSetComputeUnitLimitInstruction({ units: 250_000 }), ix], m));
  const signed = await signTransactionMessageWithSigners(message);
  return { wire: getBase64EncodedWireTransaction(signed), signature: getSignatureFromTransaction(signed), nonce: nonce.toString(), amount: amount.toString(),
    expiresAt, lastValidBlockHeight: blockhash.lastValidBlockHeight.toString(), evidenceHash };
}
