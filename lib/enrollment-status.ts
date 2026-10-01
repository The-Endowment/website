import { isSome, type Address, type Instruction, type TransactionSigner } from "@solana/kit";
import { fetchMaybeMint, fetchMaybeToken, getRevokeInstruction, TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { ata, authorityPda, base64ToBytes, decodeConfig, decodeLandlord, deregisterLandlordIx, landlordPda, MIN_DELEGATION, type Instance, type LandlordRecord } from "./endowment.ts";
import { fetchReporterPolicy } from "./reward-client.ts";

type TokenRpc = Parameters<typeof fetchMaybeToken>[0];
type AccountReader = { getAccountInfo: (key: Address, options: unknown) => { send: () => Promise<{ value: { owner: Address; data: [string, string] } | null }> } };

async function programAccount<T>(rpc: unknown, inst: Instance, key: Address, decode: (data: Uint8Array) => T | null): Promise<T | null> {
  const { value } = await (rpc as AccountReader).getAccountInfo(key, { encoding: "base64", commitment: "confirmed" }).send();
  if (!value) return null;
  if (value.owner !== inst.program || value.data[1] !== "base64") throw new Error("Account owner or encoding mismatch");
  const record = decode(base64ToBytes(value.data[0]));
  if (!record) throw new Error("Unrecognized account");
  return record;
}

export type ExitStatus = {
  owner: Address;
  landlord: LandlordRecord | null | undefined;
  dividendAccount: Address;
  dividendBalance: bigint | null;
  delegate: Address | null | undefined;
  delegatedToEndowment: boolean;
  delegationTooSmall: boolean;
  readErrors: string[];
};

/** Exit needs only the owner's PUMP account and enrollment, never a reporter or lifecycle read. */
export async function loadExitStatus(rpc: unknown, inst: Instance, owner: Address): Promise<ExitStatus> {
  const [dividendAccount, coinAccount, authority, recordAddress] = await Promise.all([
    ata(owner, inst.dividendMint, inst.dividendTokenProgram), ata(owner, inst.coinMint, inst.coinTokenProgram),
    authorityPda(inst.program, inst.config), landlordPda(inst.program, inst.config, owner),
  ]);
  const [recordResult, tokenResult] = await Promise.allSettled([
    (async () => {
      const record = await programAccount(rpc, inst, recordAddress, decodeLandlord);
      if (record && (record.owner !== owner || record.config !== inst.config || record.dividendAccount !== dividendAccount || record.coinAccount !== coinAccount)) throw new Error("Enrollment identity mismatch");
      return record;
    })(),
    (async () => {
      const token = await fetchMaybeToken(rpc as TokenRpc, dividendAccount, { commitment: "confirmed" });
      if (token.exists && (token.programAddress !== inst.dividendTokenProgram || token.data.owner !== owner || token.data.mint !== inst.dividendMint)) throw new Error("PUMP account identity mismatch");
      return token;
    })(),
  ]);
  if (recordResult.status === "rejected" && tokenResult.status === "rejected") throw new Error("Couldn't verify either your PUMP delegation or enrollment.");
  const token = tokenResult.status === "fulfilled" ? tokenResult.value : undefined;
  const delegate = token ? token.exists && isSome(token.data.delegate) ? token.data.delegate.value : null : undefined;
  const allowance = token?.exists ? token.data.delegatedAmount : 0n;
  return {
    owner, dividendAccount,
    landlord: recordResult.status === "fulfilled" ? recordResult.value : undefined,
    dividendBalance: token ? token.exists ? token.data.amount : 0n : null,
    delegate,
    delegatedToEndowment: delegate === authority && allowance >= MIN_DELEGATION,
    delegationTooSmall: delegate === authority && allowance < MIN_DELEGATION,
    readErrors: [recordResult.status === "rejected" ? "Your enrollment could not be verified." : "", tokenResult.status === "rejected" ? "Your PUMP delegation could not be verified." : ""].filter(Boolean),
  };
}

/** These reads can prevent joining, but must never prevent an owner from leaving. */
export async function loadEnrollmentDetails(rpc: unknown, inst: Instance, owner: Address) {
  const coinAccount = await ata(owner, inst.coinMint, inst.coinTokenProgram);
  const authority = await authorityPda(inst.program, inst.config);
  const directAccount = await ata(authority, inst.coinMint, inst.coinTokenProgram);
  const [config, coin, coinMint, direct, policy] = await Promise.all([
    programAccount(rpc, inst, inst.config, decodeConfig),
    fetchMaybeToken(rpc as TokenRpc, coinAccount),
    fetchMaybeMint(rpc as TokenRpc, inst.coinMint),
    fetchMaybeToken(rpc as TokenRpc, directAccount),
    fetchReporterPolicy(rpc, inst),
  ]);
  if (!config) throw new Error("The endowment isn't live yet.");
  if (!coinMint.exists || coinMint.programAddress !== inst.coinTokenProgram) throw new Error("Coin mint unavailable");
  if (coin.exists && (coin.programAddress !== inst.coinTokenProgram || coin.data.owner !== owner || coin.data.mint !== inst.coinMint)) throw new Error("Coin account identity mismatch");
  return {
    config, policy, coinAccount,
    minStake: (coinMint.data.supply * BigInt(config.params.minStakeBps) + 9_999n) / 10_000n,
    directBalance: direct.exists && direct.programAddress === inst.coinTokenProgram && direct.data.owner === authority && direct.data.mint === inst.coinMint ? direct.data.amount : null,
    coinBalance: coin.exists ? coin.data.amount : 0n,
  };
}

export type EnrollmentDetails = Awaited<ReturnType<typeof loadEnrollmentDetails>>;

/** Re-read the delegate before signing; SPL Revoke cannot condition on a later delegate change. */
export async function ownerExitInstructions(rpc: unknown, inst: Instance, signer: TransactionSigner): Promise<Instruction[]> {
  const fresh = await loadExitStatus(rpc, inst, signer.address);
  const instructions: Instruction[] = [];
  if (fresh.delegatedToEndowment || fresh.delegationTooSmall) instructions.push(getRevokeInstruction(
    { source: fresh.dividendAccount, owner: signer },
    { programAddress: inst.dividendTokenProgram as typeof TOKEN_2022_PROGRAM_ADDRESS },
  ));
  if (fresh.landlord) instructions.push(await deregisterLandlordIx(inst, signer));
  if (!instructions.length) throw new Error("No verified endowment approval or enrollment is available to remove.");
  return instructions;
}
