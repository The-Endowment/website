import "server-only";
import { createSolanaRpc } from "@solana/kit";
import { getTokenDecoder } from "@solana-program/token-2022";
import { ata, authorityPda, base64ToBytes, decodeConfig, isFlagshipConfig } from "@/lib/endowment";
import { flagshipInstance } from "@/lib/solana";
import { fundingState } from "@/lib/funding-state";
import { parseDistribution, parseSnapshot } from "@/lib/daily-sanity";

/** Public-source reads only: does not load the keeper key or build transactions. */
export async function loadDailySnapshot() {
  const inst = await flagshipInstance();
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!inst || !rpcUrl) throw new Error("Daily monitoring requires a configured, deployed endowment and RPC");
  const rpc = createSolanaRpc(rpcUrl);
  const authority = await authorityPda(inst.program, inst.config);
  const coinVault = await ata(authority, inst.coinMint, inst.coinTokenProgram);
  const abortSignal = AbortSignal.timeout(20_000);
  const [accounts, response] = await Promise.all([
    rpc.getMultipleAccounts([inst.config, coinVault], { encoding: "base64", commitment: "finalized" }).send({ abortSignal }),
    fetch(`https://www.stonkfun.xyz/api/public/v1/tokens/${inst.coinMint}/rewards`, {
      cache: "no-store", signal: abortSignal,
    }),
  ]);
  if (!response.ok) throw new Error(`StonkFun rewards API returned HTTP ${response.status}`);
  const distribution = parseDistribution(await response.json(), inst.coinMint, inst.dividendMint);
  const [configAccount, vaultAccount] = accounts.value;
  if (!configAccount || configAccount.owner !== inst.program || !vaultAccount || vaultAccount.owner !== inst.coinTokenProgram) {
    throw new Error("Missing or unexpected endowment accounts");
  }
  const config = decodeConfig(base64ToBytes(configAccount.data[0]));
  const vault = getTokenDecoder().decode(base64ToBytes(vaultAccount.data[0]));
  if (!config || !isFlagshipConfig(config) || vault.mint !== inst.coinMint || vault.owner !== authority) {
    throw new Error("Endowment snapshot identity mismatch");
  }
  const observedAt = new Date().toISOString();
  return parseSnapshot({
    version: 1,
    program: inst.program, config: inst.config, coinMint: inst.coinMint, rewardMint: inst.dividendMint,
    observedAt, ...distribution,
    slot: accounts.context.slot.toString(),
    totalSweptRaw: config.totalSwept.toString(),
    committedBps: config.lastCountBps,
    lastCountAt: config.lastCountAt.toString(),
    fundingState: fundingState(config, vault.amount, Math.floor(Date.parse(observedAt) / 1000)),
  });
}
