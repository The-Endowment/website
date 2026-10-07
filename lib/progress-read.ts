import { getTokenDecoder } from "@solana-program/token-2022";
import { ata, authorityPda, base64ToBytes, type Instance } from "./endowment.ts";
import { decodeAccount } from "./holding/codec.ts";
import type { Config } from "./holding/accounts.ts";
import type { RpcCall } from "./reporter/rpc.ts";
import { ENDOWMENT_GOAL, type ProgressSnapshot } from "./progress.ts";

const CLOCK = "SysvarC1ock11111111111111111111111111111111";
type Account = { owner: string; data: [string, string] } | null;

function bytes(account: Account, owner: string) {
  if (!account || account.owner !== owner || account.data[1] !== "base64") {
    throw new Error("Missing or unexpected progress account");
  }
  return base64ToBytes(account.data[0]);
}

/** One finalized bank read; no wallet histories, transaction scans or keeper credentials. */
export async function readProgress(rpc: RpcCall, inst: Instance, creator: string, now: number): Promise<ProgressSnapshot> {
  const authority = await authorityPda(inst.program, inst.config);
  const vault = await ata(authority, inst.coinMint, inst.coinTokenProgram);
  const bank = await rpc<{ context: { slot: number }; value: Account[] }>("getMultipleAccounts", [
    [inst.config, vault, CLOCK], { encoding: "base64", commitment: "finalized" },
  ]);
  if (bank.value.length !== 3 || !Number.isSafeInteger(bank.context.slot) || bank.context.slot < 0) {
    throw new Error("Incomplete progress snapshot");
  }
  const [configAccount, vaultAccount, clockAccount] = bank.value;
  const config = decodeAccount<Config>("Config", bytes(configAccount, inst.program));
  const founders = config.params.activate_bps === 0 && config.params.deactivate_bps === 0 && config.reserved[0] === 0;
  const publicLaunch = config.params.activate_bps === 3000 && config.params.deactivate_bps === 2500 && config.reserved[0] === 1;
  // A founders test is visibly different from the public 30% / 25% rules.
  if (config.version !== 4 || config.creator !== creator || config.coin_mint !== inst.coinMint ||
      config.dividend_mint !== inst.dividendMint || config.contribution_cap !== ENDOWMENT_GOAL ||
      (!founders && !publicLaunch)) {
    throw new Error("Unexpected flagship configuration");
  }
  const principal = getTokenDecoder().decode(bytes(vaultAccount, inst.coinTokenProgram));
  if (principal.owner !== authority || principal.mint !== inst.coinMint) throw new Error("Unexpected principal vault");
  const clock = bytes(clockAccount, "Sysvar1111111111111111111111111111111111111");
  const observedAt = Number(new DataView(clock.buffer, clock.byteOffset, clock.byteLength).getBigInt64(32, true));
  const lastCountAt = Number(config.last_count_at);
  if (!Number.isSafeInteger(observedAt) || Math.abs(now - observedAt) > 120 ||
      !Number.isSafeInteger(lastCountAt) || lastCountAt < 0 || lastCountAt > observedAt ||
      config.last_count_bps > 10_000) {
    throw new Error("Stale or invalid progress snapshot");
  }
  return {
    kind: "ready", observedAt, slot: bank.context.slot, config: inst.config, vault,
    held: principal.amount.toString(), committed: config.last_committed.toString(),
    committedBps: config.last_count_bps, lastCountAt, active: config.active,
    launchMode: founders ? "founders" : "public",
    pausedUntil: Number(config.paused_until), retired: config.retired,
    milestoneReached: config.milestone_reached,
  };
}
