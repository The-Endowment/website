import {
  getAddressEncoder,
  getProgramDerivedAddress,
  getU64Encoder,
  type Address,
  type TransactionSigner,
} from "@solana/kit";
import {
  ata,
  authorityPda,
  landlordPda,
  SYSTEM_PROGRAM,
  type Instance,
  type PoolAccounts,
} from "../endowment.ts";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { instruction } from "./codec.ts";
import type { Receipt } from "./types.ts";
const text = (s: string) => new TextEncoder().encode(s);
export const holdPda = async (
  inst: Instance,
  kind: "policy" | "consent" | "receipt",
  owner?: Address,
  nonce?: bigint,
) => {
  const seeds = [
    text(
      {
        policy: "collection_policy",
        consent: "collection_consent",
        receipt: "pending_collection",
      }[kind],
    ),
    getAddressEncoder().encode(inst.config),
  ];
  if (kind !== "policy") {
    if (!owner) throw new Error("Missing owner");
    seeds.push(getAddressEncoder().encode(owner));
  }
  if (kind === "receipt") {
    if (nonce === undefined) throw new Error("Missing nonce");
    seeds.push(getU64Encoder().encode(nonce));
  }
  return (
    await getProgramDerivedAddress({ programAddress: inst.program, seeds })
  )[0];
};
export async function common(inst: Instance, owner: Address) {
  const authority = await authorityPda(inst.program, inst.config),
    policy = await holdPda(inst, "policy");
  return {
    config: inst.config,
    authority,
    policy,
    consent: await holdPda(inst, "consent", owner),
    landlord: await landlordPda(inst.program, inst.config, owner),
    dividend_mint: inst.dividendMint,
    coin_mint: inst.coinMint,
    dividend_account: await ata(
      owner,
      inst.dividendMint,
      inst.dividendTokenProgram,
    ),
    coin_account: await ata(owner, inst.coinMint, inst.coinTokenProgram),
    pending_vault: await ata(
      policy,
      inst.dividendMint,
      inst.dividendTokenProgram,
    ),
    dividend_vault: await ata(
      authority,
      inst.dividendMint,
      inst.dividendTokenProgram,
    ),
    coin_vault: await ata(authority, inst.coinMint, inst.coinTokenProgram),
    dividend_token_program: inst.dividendTokenProgram,
    coin_token_program: inst.coinTokenProgram,
    associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    system_program: SYSTEM_PROGRAM,
  };
}
export async function consentIx(
  inst: Instance,
  owner: TransactionSigner,
  name:
    | "register_landlord"
    | "enable_collection"
    | "disable_collection"
    | "deregister_landlord",
) {
  return instruction(inst.program, name, {
    ...(await common(inst, owner.address)),
    owner,
  });
}
export async function settleIx(
  inst: Instance,
  receipt: Receipt,
  caller: TransactionSigner,
  release: boolean,
) {
  if (receipt.config !== inst.config)
    throw new Error("Receipt belongs to another endowment");
  const a = await common(inst, receipt.owner);
  return instruction(
    inst.program,
    release ? "release_collection" : "refund_collection",
    {
      ...a,
      caller,
      owner: receipt.owner,
      receipt: await holdPda(inst, "receipt", receipt.owner, receipt.nonce),
      rent_recipient: receipt.payer,
      refund_account: a.dividend_account,
    },
  );
}
export async function reviewIx(
  inst: Instance,
  receipt: Receipt,
  reviewer: TransactionSigner,
  approved: bigint,
  evidence: Uint8Array,
) {
  if (receipt.config !== inst.config || approved > receipt.amount)
    throw new Error("Invalid clearance");
  return instruction(
    inst.program,
    "review_collection",
    {
      reviewer,
      policy: await holdPda(inst, "policy"),
      receipt: await holdPda(inst, "receipt", receipt.owner, receipt.nonce),
    },
    { approved_amount: approved, evidence_hash: evidence },
  );
}
export async function collectIx(
  inst: Instance,
  owner: Address,
  pool: Address,
  poolAccounts: PoolAccounts,
  collector: TransactionSigner,
  nonce: bigint,
  report: {
    consent_epoch: bigint;
    expected_balance: bigint;
    amount: bigint;
    valid_until: bigint;
    evidence_hash: Uint8Array;
  },
) {
  const index = poolAccounts.mints.indexOf(inst.dividendMint);
  if (index < 0 || poolAccounts.mints[1 - index] !== inst.coinMint)
    throw new Error("Pool mint mismatch");
  return instruction(
    inst.program,
    "sweep",
    {
      ...(await common(inst, owner)),
      collector,
      receipt: await holdPda(inst, "receipt", owner, nonce),
      pool_state: pool,
      amm_config: poolAccounts.ammConfig,
      pool_dividend_vault: poolAccounts.vaults[index],
      pool_coin_vault: poolAccounts.vaults[1 - index],
    },
    { nonce, report },
  );
}
