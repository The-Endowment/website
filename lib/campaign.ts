import { collectionServiceReady } from "./holding/status";
import { createHash } from "node:crypto";
import { fetchMaybeToken } from "@solana-program/token-2022";
import { getAddressDecoder, type Address, type Signature } from "@solana/kit";
import {
  ata,
  attestationsOf,
  authorityPda,
  base64ToBytes,
  decodeConfig,
  fetchDecoded,
  LEGACY_TOKEN_PROGRAM,
  listLandlords,
  parsePool,
  REQUIRED_ATTESTATIONS,
} from "@/lib/endowment";
import { flagshipInstance, readRpc } from "@/lib/solana";
import { fundingState, type FundingState } from "@/lib/funding-state";

/** One landlord, as the campaign shows it. Amounts are base-unit strings (6 decimals). */
export type CampaignLandlord = {
  owner: Address;
  /** What it counted for at its last count, and that count's round. */
  counted: string;
  countedRound: number;
  /** The most its next count can credit. */
  recorded: string;
  checks: number;
  required: number;
  /** PUMP it has contributed since joining. */
  contributed: string;
};

export type CampaignBuy = { signature: string; time: number; pumpIn: string; penisOut: string };

export type Campaign =
  | { launched: false }
  | {
      launched: true;
      stage: "raising" | "live" | "complete";
      fundingState: FundingState;
      active: boolean;
      activateBps: number;
      deactivateBps: number;
      committedBps: number;
      committed: string;
      /** Coin supply the last count measured against (or the live supply before any count). */
      supply: string;
      lastCountAt: number;
      landlordCount: number;
      totalSwept: string;
      totalSpent: string;
      totalBought: string;
      directHeld: string;
      milestone: string;
      landlords: CampaignLandlord[];
      buys: CampaignBuy[];
      buysLastDay: number;
    };

/** Anchor's event discriminator: the first 8 bytes of sha256("event:<Name>"). */
const BOUGHT_DISC = createHash("sha256").update("event:Bought").digest().subarray(0, 8);

type SigInfo = { signature: Signature; blockTime: bigint | number | null; err: unknown };
type TxInfo = { blockTime: bigint | number | null; meta: { logMessages: readonly string[] | null } | null } | null;

/**
 * Recent buys, found through the endowment's liquidity vault: every buyback
 * passes that account, and nothing else does, so its signatures are buys only.
 */
async function recentBuys(
  rpc: ReturnType<typeof readRpc>,
  program: Address,
  config: Address,
  pool: Address,
): Promise<{ buys: CampaignBuy[]; lastDay: number }> {
  const poolInfo = await rpc.getAccountInfo(pool, { encoding: "base64" }).send();
  if (!poolInfo.value) return { buys: [], lastDay: 0 };
  const { lpMint } = parsePool(base64ToBytes(poolInfo.value.data[0]));
  const lpVault = await ata(await authorityPda(program, config), lpMint, LEGACY_TOKEN_PROGRAM);

  const sigs = (await rpc.getSignaturesForAddress(lpVault, { limit: 100 }).send()) as unknown as SigInfo[];
  const ok = sigs.filter((s) => s.err === null && s.blockTime !== null);
  const now = Math.floor(Date.now() / 1000);
  const lastDay = ok.filter((s) => Number(s.blockTime) >= now - 86_400).length;

  const buys: CampaignBuy[] = [];
  const configBytes = getAddressDecoder();
  for (const s of ok.slice(0, 10)) {
    const tx = (await rpc
      .getTransaction(s.signature, { encoding: "json", maxSupportedTransactionVersion: 0 })
      .send()) as unknown as TxInfo;
    for (const line of tx?.meta?.logMessages ?? []) {
      if (!line.startsWith("Program data: ")) continue;
      const data = base64ToBytes(line.slice("Program data: ".length));
      if (data.length < 56 || !BOUGHT_DISC.every((b, i) => data[i] === b)) continue;
      if (configBytes.decode(data.slice(8, 40)) !== config) continue;
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      buys.push({
        signature: s.signature,
        time: Number(s.blockTime),
        pumpIn: view.getBigUint64(40, true).toString(),
        penisOut: view.getBigUint64(48, true).toString(),
      });
    }
  }
  return { buys, lastDay };
}

/** Everything the home page campaign shows, read through the public RPC (never the keeper's). */
export async function loadCampaign(): Promise<Campaign> {
  const inst = await flagshipInstance();
  if (!inst) return { launched: false };
  const rpc = readRpc();
  const config = await fetchDecoded(rpc, inst.config, decodeConfig);
  if (!config) return { launched: false };

  const authority = await authorityPda(inst.program, inst.config);
  const coinVault = await fetchMaybeToken(rpc, await ata(authority, inst.coinMint, inst.coinTokenProgram));
  if (!coinVault.exists) throw new Error("The endowment coin vault is unavailable");
  const reporterReady = await collectionServiceReady(rpc, inst, config);
  const state = fundingState(config, coinVault.data.amount, Math.floor(Date.now() / 1000), reporterReady);

  let supply = config.count.supply;
  if (supply === BigInt(0)) {
    const s = await rpc.getTokenSupply(inst.coinMint).send();
    supply = BigInt(s.value.amount);
  }

  const landlords = (await listLandlords(rpc, inst.program, inst.config)).map(({ record }) => ({
    owner: record.owner,
    counted: record.countedAmount.toString(),
    countedRound: Number(record.countedRound),
    recorded: (record.snapshotValid ? record.snapshot : BigInt(0)).toString(),
    checks: Math.min(attestationsOf(config, record), REQUIRED_ATTESTATIONS),
    required: REQUIRED_ATTESTATIONS,
    contributed: record.totalContributed.toString(),
  }));

  // Treasury income and direct donations can fund buys without any holder sweep.
  const live =
    config.active || config.totalSwept > BigInt(0) || config.totalCoinBought > BigInt(0);
  const { buys, lastDay } = live ? await recentBuys(rpc, inst.program, inst.config, config.pool) : { buys: [], lastDay: 0 };

  return {
    launched: true,
    stage: state === "complete" ? "complete" : live ? "live" : "raising",
    fundingState: state,
    active: state === "enabled",
    activateBps: config.params.activateBps,
    deactivateBps: config.params.deactivateBps,
    committedBps: config.lastCountBps,
    committed: config.lastCommitted.toString(),
    supply: supply.toString(),
    lastCountAt: Number(config.lastCountAt),
    landlordCount: config.landlordCount,
    totalSwept: config.totalSwept.toString(),
    totalSpent: config.totalDividendSpent.toString(),
    totalBought: config.totalCoinBought.toString(),
    directHeld: coinVault.data.amount.toString(),
    milestone: config.contributionCap.toString(),
    landlords,
    buys,
    buysLastDay: lastDay,
  };
}
