import { getAddressDecoder, isSome, type Address } from "@solana/kit";
import { getTokenDecoder } from "@solana-program/token-2022";
import { ACTIVE_MAX_AGE_SECS, ata, authorityPda, base64ToBytes, CPMM_PROGRAM, decodeConfig, decodeLandlord, landlordPda, MAX_VAULT_DAYS_OF_BUYS, MIN_DELEGATION, parsePool, type EndowmentConfig, type Instance, type PoolAccounts } from "../endowment.ts";
import { decodeReporterPolicy, reporterPolicyPda } from "../reward-client.ts";
import type { RpcCall } from "./rpc.ts";

export type Snapshot = {
  binding: string; slot: number; now: number; active: boolean; reason: string;
  balance: string; nonce: string; allowance: string; capacity: string;
  consentId: string; collectionEpoch: string; reporterEpoch: string; reporter: string;
};
export type ChainSnapshot = Snapshot & { config: EndowmentConfig; pool: PoolAccounts };
type Account = { owner: string; data: [string, string] };
const CLOCK = "SysvarC1ock11111111111111111111111111111111";
const U64_MAX = (1n << 64n) - 1n;
const clampU64 = (value: bigint) => value < U64_MAX ? value : U64_MAX;
function bytes(account: Account | null, owner: string) {
  if (!account || account.owner !== owner || account.data[1] !== "base64") throw new Error("Account owner or encoding mismatch");
  return base64ToBytes(account.data[0]);
}

/** One bank snapshot for all lifecycle, consent, source and vault balances. */
export async function chainSnapshot(rpc: RpcCall, inst: Instance, owner: Address, minSlot = 0): Promise<ChainSnapshot> {
  const authority = await authorityPda(inst.program, inst.config);
  const source = await ata(owner, inst.dividendMint, inst.dividendTokenProgram);
  const landlord = await landlordPda(inst.program, inst.config, owner);
  // Discover the pool; recheck it in the atomic snapshot so a stale read cannot mix instances.
  const initial = await rpc<{ value: Account | null }>("getAccountInfo", [inst.config, { encoding: "base64", commitment: "finalized" }]);
  const expected = decodeConfig(bytes(initial.value, inst.program));
  if (!expected) throw new Error("Unknown config account");
  const addresses = [inst.config, landlord, await reporterPolicyPda(inst), source,
    await ata(authority, inst.dividendMint, inst.dividendTokenProgram), await ata(authority, inst.coinMint, inst.coinTokenProgram), expected.pool, CLOCK];
  const response = await rpc<{ context: { slot: number }; value: (Account | null)[] }>("getMultipleAccounts", [addresses,
    { encoding: "base64", commitment: "finalized", minContextSlot: minSlot }]);
  const [c, l, p, s, v, coin, pool, clock] = response.value;
  const config = decodeConfig(bytes(c, inst.program));
  const record = l ? decodeLandlord(bytes(l, inst.program)) : null;
  const policy = decodeReporterPolicy(bytes(p, inst.program));
  if (!config || !policy || (l && !record) || config.version !== 4 || config.pool !== expected.pool || config.coinMint !== inst.coinMint
      || config.dividendMint !== inst.dividendMint || policy.config !== inst.config
      || (record && (record.version !== 4 || record.config !== inst.config || record.owner !== owner || record.dividendAccount !== source))) {
    throw new Error("Unrecognized version, instance, or reward consent");
  }
  const token = getTokenDecoder();
  const sourceToken = s ? token.decode(bytes(s, inst.dividendTokenProgram)) : null;
  const vault = token.decode(bytes(v, inst.dividendTokenProgram));
  const coinVault = token.decode(bytes(coin, inst.coinTokenProgram));
  if ((sourceToken && (sourceToken.mint !== inst.dividendMint || sourceToken.owner !== owner))
      || vault.mint !== inst.dividendMint || vault.owner !== authority || coinVault.mint !== inst.coinMint || coinVault.owner !== authority) {
    throw new Error("Token account identity mismatch");
  }
  const clockBytes = bytes(clock, "Sysvar1111111111111111111111111111111111111");
  const now = Number(new DataView(clockBytes.buffer, clockBytes.byteOffset).getBigInt64(32, true));
  const slot = response.context.slot;
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(slot) || slot < minSlot || Math.abs(Date.now() / 1000 - now) > 120) {
    throw new Error("Stale or inconsistent chain clock");
  }
  const poolBytes = bytes(pool, CPMM_PROGRAM);
  if (getAddressDecoder().decode(poolBytes.slice(168, 200)) !== inst.dividendMint
      && getAddressDecoder().decode(poolBytes.slice(200, 232)) !== inst.dividendMint) throw new Error("Unexpected pool mints");
  const delegated = sourceToken && isSome(sourceToken.delegate) && sourceToken.delegate.value === authority && sourceToken.delegatedAmount >= MIN_DELEGATION;
  const complete = config.milestoneReached || coinVault.amount >= config.contributionCap;
  const active = Boolean(record && delegated && !policy.disabled && !complete && !config.retired && now >= Number(config.pausedUntil)
    && config.active && (config.params.activateBps === 0 || now - Number(config.lastCountAt) <= ACTIVE_MAX_AGE_SECS));
  const pms = config.params;
  // Match Config::vault_cap: clamp the interval allowance, then saturate the days multiplier.
  const byInterval = clampU64(pms.maxBuyPerTx * 86_400n / (pms.minBuyIntervalSecs > 0n ? pms.minBuyIntervalSecs : 1n));
  const cap = clampU64((byInterval < pms.maxBuyPerDay ? byInterval : pms.maxBuyPerDay) * BigInt(MAX_VAULT_DAYS_OF_BUYS));
  return { config, pool: parsePool(poolBytes), binding: [inst.config, owner, source, record?.consentId ?? 0n, config.collectionEpoch, policy.epoch].join(":"),
    slot, now, active, reason: active ? "Active reward consent" : "Collection inactive; discard pending eligibility",
    balance: (sourceToken?.amount ?? 0n).toString(), nonce: (record?.lastReportNonce ?? 0n).toString(), allowance: (sourceToken?.delegatedAmount ?? 0n).toString(),
    capacity: (cap > vault.amount ? cap - vault.amount : 0n).toString(), consentId: (record?.consentId ?? 0n).toString(),
    collectionEpoch: config.collectionEpoch.toString(), reporterEpoch: policy.epoch.toString(), reporter: policy.reporter,
  };
}
