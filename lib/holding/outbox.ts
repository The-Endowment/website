import type { Prepared } from "../reporter/types.ts";
import type { Journal } from "../reporter/journal.ts";
import { boundary } from "../reporter/ledger.ts";
import type { RpcCall } from "../reporter/rpc.ts";
export async function signatureStatus(rpc: RpcCall, signature: string) {
  const result = await rpc<{
    value: ({ confirmationStatus: string; err: unknown } | null)[];
  }>("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
  const s = result.value[0];
  return s?.confirmationStatus === "finalized"
    ? s.err
      ? "failed"
      : "finalized"
    : "pending";
}
export async function publish(rpc: RpcCall, wire: string) {
  await rpc("sendTransaction", [
    wire,
    {
      encoding: "base64",
      skipPreflight: false,
      preflightCommitment: "finalized",
      maxRetries: 0,
    },
  ]);
}
/** Receipt settlement is one-shot on chain. Persist the exact signed bytes
 * before sending and resolve the old outbox before preparing another action. */
export async function settleOutbox(
  journal: Journal,
  rpc: RpcCall,
  receipt: string,
  prepare: () => Promise<Prepared>,
  beforePublish?: () => Promise<void>,
) {
  const prior = journal.state?.pending;
  if (prior) {
    const status = await signatureStatus(rpc, prior.signature);
    if (
      status === "pending" &&
      BigInt(
        await rpc<number>("getBlockHeight", [{ commitment: "finalized" }]),
      ) <= BigInt(prior.lastValidBlockHeight)
    )
      return "pending";
    // End this tick after recovery; the next tick rereads receipt and consent.
    await journal.save(
      boundary(receipt, 0, null, "0"),
      `Settlement outcome: ${status}; reread on-chain receipt before any retry`,
      { signature: prior.signature },
    );
    return "reconciled";
  }
  const pending = await prepare();
  await journal.save(
    { ...boundary(receipt, 0, null, "0"), pending },
    "Prepared settlement before broadcast",
  );
  await beforePublish?.();
  await publish(rpc, pending.wire);
  return "submitted";
}
