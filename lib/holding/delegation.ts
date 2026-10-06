/** Browser-safe dashboard reads and an independently usable approval revoke. */
import { isSome, type Address, type TransactionSigner } from "@solana/kit";
import { fetchMaybeMint, fetchMaybeToken, getRevokeInstruction, TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import {
  ata, authorityPda, decodeConfig, decodeLandlord, fetchDecoded, isFlagshipConfig,
  landlordPda, MIN_DELEGATION, type EndowmentConfig, type Instance, type LandlordRecord,
} from "../endowment.ts";

export type DelegationStatus = {
  config: EndowmentConfig;
  landlord: LandlordRecord | null;
  dividendAccount: Address;
  coinAccount: Address;
  dividendBalance: bigint;
  coinBalance: bigint;
  dividendDecimals: number;
  delegate: Address | null;
  delegatedToEndowment: boolean;
  delegationTooSmall: boolean;
  minStake: bigint;
  now: number;
};
type TokenRpc = Parameters<typeof fetchMaybeToken>[0];

export async function loadDelegationStatus(rpc: TokenRpc, inst: Instance, owner: Address): Promise<DelegationStatus> {
  const dividendAccount = await ata(owner, inst.dividendMint, inst.dividendTokenProgram);
  const coinAccount = await ata(owner, inst.coinMint, inst.coinTokenProgram);
  const [config, landlord, dividend, coin, mint, dividendMint] = await Promise.all([
    fetchDecoded(rpc, inst.config, decodeConfig),
    fetchDecoded(rpc, await landlordPda(inst.program, inst.config, owner), decodeLandlord),
    fetchMaybeToken(rpc, dividendAccount), fetchMaybeToken(rpc, coinAccount),
    fetchMaybeMint(rpc, inst.coinMint), fetchMaybeMint(rpc, inst.dividendMint),
  ]);
  if (!config || !isFlagshipConfig(config)) throw new Error("The endowment isn't live yet.");
  const authority = await authorityPda(inst.program, inst.config);
  const delegate = dividend.exists && isSome(dividend.data.delegate) ? dividend.data.delegate.value : null;
  const delegatedAmount = dividend.exists ? dividend.data.delegatedAmount : 0n;
  const ours = delegate === authority;
  const supply = mint.exists ? mint.data.supply : 0n;
  return {
    config, landlord, dividendAccount, coinAccount,
    dividendBalance: dividend.exists ? dividend.data.amount : 0n,
    coinBalance: coin.exists ? coin.data.amount : 0n,
    dividendDecimals: dividendMint.exists ? dividendMint.data.decimals : 6,
    delegate, delegatedToEndowment: ours && delegatedAmount >= MIN_DELEGATION,
    delegationTooSmall: ours && delegatedAmount < MIN_DELEGATION,
    minStake: (supply * BigInt(config.params.minStakeBps) + 9_999n) / 10_000n,
    now: Math.floor(Date.now() / 1000),
  };
}

/** Only the wallet's PUMP account is read. A failed dashboard/receipt query
 * cannot block this path. Check the current delegate before preparing a revoke;
 * the wallet can still change its delegate before the transaction executes. */
export async function revokeEndowmentApprovalIx(rpc: TokenRpc, inst: Instance, owner: TransactionSigner) {
  const source = await ata(owner.address, inst.dividendMint, inst.dividendTokenProgram);
  const token = await fetchMaybeToken(rpc, source);
  if (!token.exists) throw new Error("This wallet has no PUMP token account to revoke.");
  if (token.programAddress !== inst.dividendTokenProgram || token.data.owner !== owner.address || token.data.mint !== inst.dividendMint) {
    throw new Error("Could not verify this wallet's PUMP account. No approval was changed.");
  }
  const authority = await authorityPda(inst.program, inst.config);
  if (!isSome(token.data.delegate) || token.data.delegate.value !== authority) {
    throw new Error("There is no approval for this endowment. Any other app's approval was left unchanged.");
  }
  return getRevokeInstruction({ source, owner }, {
    programAddress: inst.dividendTokenProgram as typeof TOKEN_2022_PROGRAM_ADDRESS,
  });
}
