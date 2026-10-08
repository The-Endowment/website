import { mkdir, rm, writeFile, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createSolanaRpc } from "@solana/kit";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { flagshipConfig, PROGRAM_ID, PENIS_MINT, PUMP_MINT, type Instance } from "../lib/endowment.ts";
import { holdPda } from "../lib/holding/client.ts";
import { decodeAccount } from "../lib/holding/codec.ts";
import { accountBytes } from "../lib/holding/snapshot.ts";
import type { Config, Policy } from "../lib/holding/types.ts";
import { keySigner } from "../lib/holding/sign.ts";
import { jsonRpc } from "../lib/reporter/rpc.ts";
import { countHealth, runCount, runRefresh, runRewardPost, type Keeper } from "../lib/keeper-runtime.ts";
import { assertRefresherRoles, refresherPass } from "../lib/refresher.ts";
import { deliverHeartbeat } from "../lib/operations-heartbeat.ts";

const submit = process.argv.includes("--submit");
async function main() {
  if (submit === process.argv.includes("--check")) throw new Error("Choose --check or --submit");
  const rpcUrl = process.env.SOLANA_RPC_URL, data = process.env.REFRESHER_DATA_DIR;
  const jitter = process.env.REFRESHER_JITTER_SECRET;
  const config = await flagshipConfig();
  if (!rpcUrl || !data || !jitter || !PROGRAM_ID || !config) throw new Error("Missing refresher configuration");
  const directory = resolve(data);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, "refresher.lock");
  await mkdir(lock); // A crashed pass requires an operator to inspect/remove its stale lock.
  try {
    const signer = await keySigner(process.env.REFRESHER_KEYPAIR_FILE);
    const inst: Instance = { program: PROGRAM_ID, config, coinMint: PENIS_MINT, dividendMint: PUMP_MINT,
      coinTokenProgram: TOKEN_2022_PROGRAM_ADDRESS, dividendTokenProgram: TOKEN_2022_PROGRAM_ADDRESS };
    const k: Keeper = { rpc: createSolanaRpc(rpcUrl), signer, inst, drawSecret: jitter,
      priorityMicroLamports: BigInt(process.env.KEEPER_PRIORITY_MICROLAMPORTS ?? 5000) };
    const rpc = jsonRpc(rpcUrl), policy = await holdPda(inst, "policy");
    const verify = async () => {
      type Account = { owner: string; data: [string, string] };
      const bank = await rpc<{ value: (Account | null)[] }>("getMultipleAccounts", [
        [config, policy], { encoding: "base64", commitment: "confirmed" },
      ]);
      const c = decodeAccount<Config>("Config", accountBytes(bank.value[0], inst.program));
      const p = decodeAccount<Policy>("CollectionPolicy", accountBytes(bank.value[1], inst.program));
      if (c.version !== 4 || c.coin_mint !== inst.coinMint || c.dividend_mint !== inst.dividendMint || p.config !== config)
        throw new Error("Refresher account mismatch");
      assertRefresherRoles(signer.address, { refresher: c.params.refresher, collector: p.collector, reviewer: p.reviewer });
    };
    await verify();
    if (!submit) {
      console.log(JSON.stringify({ check: "roles_verified", health: await countHealth(k) }));
      return;
    }
    const report = { finishedAt: "", ...await refresherPass({ verify,
      refresh: () => runRefresh(k), count: () => runCount(k), post: () => runRewardPost(k) }) };
    report.finishedAt = new Date().toISOString();
    const file = join(directory, "health.json");
    await writeFile(`${file}.tmp`, JSON.stringify(report) + "\n", { mode: 0o600 });
    await rename(`${file}.tmp`, file);
    console.log(JSON.stringify(report));
    if (!report.ok) process.exitCode = 1;
  } finally { await rm(lock, { recursive: true }); }
}

let success = false;
try { await main(); success = !process.exitCode; }
catch { console.error("Refresher failed; inspect configuration, role custody, lock and provider status."); process.exitCode = 1; }
// Diagnostic runs cannot keep a failed production schedule looking healthy.
if (submit) {
  const heartbeat = await deliverHeartbeat({ endpoint: process.env.REFRESHER_HEARTBEAT_URL, role: "refresher", success });
  if (heartbeat === "failed") { console.error("Refresher heartbeat delivery failed."); process.exitCode = 1; }
}
