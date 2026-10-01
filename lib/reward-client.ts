import {
  AccountRole, fixDecoderSize, getAddressDecoder, getBooleanDecoder, getBytesDecoder,
  getI64Decoder, getI64Encoder, getProgramDerivedAddress, getAddressEncoder, getStructDecoder, getU64Decoder, getU64Encoder, getU8Decoder,
  type Address, type Instruction, type TransactionSigner,
} from "@solana/kit";
import { ata, authorityPda, landlordPda, SYSTEM_PROGRAM, type Instance, type PoolAccounts } from "./endowment.ts";
import { REWARD_DISC } from "./reporter/discriminators.ts";

export const reporterPolicyPda = async (inst: Instance) => (await getProgramDerivedAddress({
  programAddress: inst.program, seeds: [new TextEncoder().encode("reporter"), getAddressEncoder().encode(inst.config)],
}))[0];
const policyDecoder = getStructDecoder([
  ["discriminator", fixDecoderSize(getBytesDecoder(), 8)], ["config", getAddressDecoder()],
  ["reporter", getAddressDecoder()], ["pending", getAddressDecoder()], ["effectiveAt", getI64Decoder()],
  ["epoch", getU64Decoder()], ["disabled", getBooleanDecoder()], ["bump", getU8Decoder()],
]);
export type ReporterPolicy = ReturnType<typeof policyDecoder.decode>;
export function decodeReporterPolicy(data: Uint8Array): ReporterPolicy | null {
  return REWARD_DISC.reporter_policy.every((byte, index) => data[index] === byte) ? policyDecoder.decode(data) : null;
}
const R = AccountRole.READONLY, W = AccountRole.WRITABLE;
const meta = (address: Address, role = R) => ({ address, role });
const signerMeta = (signer: TransactionSigner, writable = false) => ({ address: signer.address, signer, role: writable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER });

export async function enrollRewardsIx(inst: Instance, owner: TransactionSigner): Promise<Instruction> {
  return { programAddress: inst.program, data: new Uint8Array(REWARD_DISC.enroll_rewards), accounts: [
    signerMeta(owner, true), meta(inst.config, W), meta(await authorityPda(inst.program, inst.config)),
    meta(await landlordPda(inst.program, inst.config, owner.address), W), meta(inst.dividendMint),
    meta(await ata(owner.address, inst.dividendMint, inst.dividendTokenProgram)), meta(inst.coinMint),
    meta(await ata(owner.address, inst.coinMint, inst.coinTokenProgram)), meta(inst.dividendTokenProgram),
    meta(inst.coinTokenProgram), meta(await reporterPolicyPda(inst)), meta(SYSTEM_PROGRAM),
  ] };
}
export async function renewRewardConsentIx(inst: Instance, owner: TransactionSigner): Promise<Instruction> {
  return { programAddress: inst.program, data: new Uint8Array(REWARD_DISC.renew_reward_consent), accounts: [
    signerMeta(owner), meta(inst.config, W), meta(await landlordPda(inst.program, inst.config, owner.address), W),
    meta(await ata(owner.address, inst.dividendMint, inst.dividendTokenProgram)),
  ] };
}
export type RewardReport = {
  consentId: bigint; nonce: bigint; collectionEpoch: bigint; reporterEpoch: bigint;
  amount: bigint; expectedSourceBalance: bigint; issuedAt: bigint; expiresAt: bigint; evidenceHash: Uint8Array;
};
export function encodeReport(report: RewardReport): Uint8Array {
  if (report.evidenceHash.length !== 32) throw new Error("Evidence hash must contain 32 bytes");
  const data = new Uint8Array(96); const u = getU64Encoder(), i = getI64Encoder();
  [report.consentId, report.nonce, report.collectionEpoch, report.reporterEpoch, report.amount, report.expectedSourceBalance]
    .forEach((value, index) => data.set(u.encode(value), index * 8));
  data.set(i.encode(report.issuedAt), 48); data.set(i.encode(report.expiresAt), 56); data.set(report.evidenceHash, 64);
  return data;
}
export async function collectRewardIx(inst: Instance, owner: Address, pool: Address, accounts: PoolAccounts, reporter: TransactionSigner, report: RewardReport): Promise<Instruction> {
  const authority = await authorityPda(inst.program, inst.config);
  const dividendIndex = accounts.mints.indexOf(inst.dividendMint);
  if (dividendIndex < 0 || accounts.mints[1 - dividendIndex] !== inst.coinMint) throw new Error("Pool mint mismatch");
  const data = new Uint8Array(104); data.set(REWARD_DISC.collect_reward); data.set(encodeReport(report), 8);
  return { programAddress: inst.program, data, accounts: [
    meta(inst.config, W), meta(authority), meta(await landlordPda(inst.program, inst.config, owner), W),
    meta(inst.dividendMint), meta(await ata(owner, inst.dividendMint, inst.dividendTokenProgram), W),
    meta(await ata(authority, inst.dividendMint, inst.dividendTokenProgram), W), meta(inst.coinMint),
    meta(await ata(authority, inst.coinMint, inst.coinTokenProgram)), meta(pool), meta(accounts.ammConfig),
    meta(accounts.vaults[dividendIndex]), meta(accounts.vaults[1 - dividendIndex]), meta(inst.dividendTokenProgram),
    meta(await reporterPolicyPda(inst)), signerMeta(reporter),
  ] };
}

/** Authenticate the policy account before showing a reporter or enabling consent. */
export async function fetchReporterPolicy(rpc: unknown, inst: Instance): Promise<ReporterPolicy | null> {
  type Reader = { getAccountInfo: (key: Address, options: unknown) => { send: () => Promise<{ value: { owner: Address; data: [string, string] } | null }> } };
  const { value } = await (rpc as Reader).getAccountInfo(await reporterPolicyPda(inst), { encoding: "base64", commitment: "finalized" }).send();
  if (!value || value.owner !== inst.program || value.data[1] !== "base64") return null;
  const bytes = Uint8Array.from(atob(value.data[0]), (char) => char.charCodeAt(0));
  const policy = decodeReporterPolicy(bytes);
  return policy?.config === inst.config ? policy : null;
}
