import type { TransactionSigner } from "@solana/kit";
import { resyncBaselineIx, type Instance } from "../endowment.ts";
import { consentIx } from "./client.ts";
import type { DelegationStatus } from "./delegation.ts";
import type { Holding } from "./wallet.ts";

/** Use the existing owner-signed instructions; never change protection mode or
 * renew an approval as a side effect of resetting the fixed balance floor. */
export async function baselineResetInstructions(
  inst: Instance, owner: TransactionSigner, status: DelegationStatus, holding: Holding,
  preview: { baseline: bigint; balance: bigint; consentEpoch: bigint },
) {
  const landlord = status.landlord;
  if (!landlord || landlord.owner !== owner.address || landlord.config !== inst.config
      || landlord.reserved[0] !== 0 || !status.delegatedToEndowment
      || !holding.ready || !holding.consent?.enabled
      || holding.consent.owner !== owner.address || holding.consent.config !== inst.config)
    throw new Error("Your enrollment changed. Refresh before resetting your protected balance.");
  if (status.config.retired || status.config.milestoneReached || status.now < Number(status.config.pausedUntil))
    throw new Error("Collection cannot restart now. Stop, revoke and reclaim remain available.");
  if (status.dividendBalance >= landlord.baseline)
    throw new Error("Your balance is no longer below the protected starting balance. No reset is needed.");
  if (landlord.baseline !== preview.baseline || status.dividendBalance !== preview.balance
      || holding.consent.epoch !== preview.consentEpoch)
    throw new Error("Your balance or consent changed. Refresh and review the new amounts before signing.");
  return [await resyncBaselineIx(inst, owner, status.dividendAccount),
    await consentIx(inst, owner, "enable_collection")];
}
