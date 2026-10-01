import {
  getRevokeInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import type { Instruction, TransactionSigner } from "@solana/kit";
import { type Instance } from "../endowment.ts";
import { loadExitStatus } from "../enrollment-status.ts";
import { decodeAccount } from "./codec.ts";
import { consentIx, holdPda } from "./client.ts";
import { accountBytes } from "./snapshot.ts";
import type { RpcCall } from "../reporter/rpc.ts";
import type { Consent } from "./types.ts";

/** Does not depend on the pool, counting, reviewer availability, or active state. */
export async function stopCollection(
  rpc: unknown,
  rawRpc: RpcCall,
  inst: Instance,
  signer: TransactionSigner,
): Promise<Instruction[]> {
  const consentAddress = await holdPda(inst, "consent", signer.address);
  const result = await Promise.allSettled([
    loadExitStatus(rpc, inst, signer.address),
    rawRpc<{ value: { owner: string; data: [string, string] } | null }>(
      "getAccountInfo",
      [
        consentAddress,
        { encoding: "base64", commitment: "finalized" },
      ],
    ),
  ]);
  const ixs: Instruction[] = [];
  if (result[0].status === "fulfilled") {
    const status = result[0].value;
    if (status.delegatedToEndowment || status.delegationTooSmall)
      ixs.push(
        getRevokeInstruction(
          { source: status.dividendAccount, owner: signer },
          {
            programAddress:
              inst.dividendTokenProgram as typeof TOKEN_2022_PROGRAM_ADDRESS,
          },
        ),
      );
  }
  if (result[1].status === "fulfilled" && result[1].value.value) {
    try {
      const consent = decodeAccount<Consent>(
        "CollectionConsent",
        accountBytes(result[1].value.value, inst.program),
      );
      if (consent.owner !== signer.address || consent.config !== inst.config)
        throw new Error("Consent identity mismatch");
      ixs.push(await consentIx(inst, signer, "disable_collection"));
    } catch {
      // A failed consent read/decode must not block an independently verified
      // token revocation. No consent instruction is inferred from bad data.
    }
  }
  if (!ixs.length)
    throw new Error(
      "Could not verify any permission to remove. You can revoke the token delegation directly in your wallet.",
    );
  return ixs;
}
