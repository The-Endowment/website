import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { address } from "@solana/kit";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { ata, decodeLandlord, base64ToBytes, flagshipConfig, PROGRAM_ID, PENIS_MINT, PUMP_MINT, type Instance } from "../lib/endowment.ts";
import { COLLECTION_RELEASED } from "../lib/collection-policy.ts";
import { classify, distributions } from "../lib/reporter/classify.ts";
import { runWallet } from "../lib/reporter/engine.ts";
import { withJournal } from "../lib/reporter/journal.ts";
import { history, jsonRpc, latestCursor } from "../lib/reporter/rpc.ts";
import { chainSnapshot, type ChainSnapshot } from "../lib/reporter/snapshot.ts";
import { prepareCollection } from "../lib/reporter/sign.ts";
import type { SourcePolicy } from "../lib/reporter/types.ts";

const SOURCE: SourcePolicy = {
  mint: PUMP_MINT, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  authority: "HuBMeYW3aDn8BH65fo8xxbP4oiexyup8udzKyccgi8Ga", source: "J8vxiGw4gPng3JTN9HoKJs3ioCD5fnjKGDtRHPVGgaGo",
};

export async function main() {
  const submit = process.argv.includes("--submit");
  if (submit && !COLLECTION_RELEASED) throw new Error("Collection release hold: independent review and authorized rollout are required");
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const directory = process.env.REPORTER_DATA_DIR;
  const config = await flagshipConfig();
  if (!rpcUrl || !directory || !PROGRAM_ID || !config) throw new Error("Set reviewed flagship settings, SOLANA_RPC_URL and durable REPORTER_DATA_DIR");
  const rpc = jsonRpc(rpcUrl);
  const inst: Instance = { program: PROGRAM_ID, config, coinMint: PENIS_MINT, dividendMint: PUMP_MINT,
    coinTokenProgram: TOKEN_2022_PROGRAM_ADDRESS, dividendTokenProgram: TOKEN_2022_PROGRAM_ADDRESS };
  // Inspect all program accounts, then filter decoded records. This read is
  // only discovery: chainSnapshot authenticates consent before any collection.
  const rows = await rpc<{ pubkey: string; account: { data: [string, string] } }[]>("getProgramAccounts", [inst.program, { encoding: "base64", commitment: "finalized" }]);
  const owners = rows.flatMap((row) => {
    const record = decodeLandlord(base64ToBytes(row.account.data[0]));
    return record?.config === config && record.version === 4 ? [record.owner] : [];
  }).sort();
  // Rotate the starting wallet each day; contributions do not buy privileges.
  const offset = owners.length ? Math.floor(Date.now() / 86_400_000) % owners.length : 0;
  const ordered = [...owners.slice(offset), ...owners.slice(0, offset)];
  for (const owner of ordered) {
    const source = await ata(owner, PUMP_MINT, TOKEN_2022_PROGRAM_ADDRESS);
    try {
      const outcome = await withJournal(resolve(directory), source, async (journal) => {
        let latest: ChainSnapshot;
        return runWallet(journal, {
          snapshot: async (minSlot) => (latest = await chainSnapshot(rpc, inst, owner, minSlot)),
          cursor: (snapshot) => latestCursor(rpc, source, snapshot.slot),
          observations: async (ledger, snapshot) => {
            const response = await fetch("https://www.stonkfun.xyz/api/public/v1/rewards?limit=100", { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000) });
            if (!response.ok) throw new Error(`StonkFun feed HTTP ${response.status}`);
            const feed = distributions(await response.json());
            const batch = await history(rpc, source, ledger.cursor, ledger.slot, snapshot.slot);
            return { cursor: batch.cursor, observations: batch.transactions.map((tx) => classify(tx, source, owner, SOURCE, feed)) };
          },
          prepare: async (snapshot, amount, hash) => {
            if (snapshot !== latest) throw new Error("Signing snapshot mismatch");
            const keyFile = process.env.REPORTER_KEYPAIR_FILE;
            if (!keyFile) throw new Error("Set REPORTER_KEYPAIR_FILE for authorized submission");
            const key = JSON.parse(await readFile(keyFile, "utf8"));
            if (!Array.isArray(key) || key.length !== 64 || !key.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) throw new Error("Invalid reporter key file");
            return prepareCollection(rpcUrl, Uint8Array.from(key), inst, address(owner), latest, amount, hash);
          },
          status: async (signature) => {
            const response = await rpc<{ value: ({ confirmationStatus: string; err: unknown } | null)[] }>("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
            const status = response.value[0];
            return status?.confirmationStatus === "finalized" ? status.err ? "failed" : "finalized" : "pending";
          },
          height: async () => BigInt(await rpc<number>("getBlockHeight", [{ commitment: "finalized" }])),
          publish: async (wire) => { await rpc("sendTransaction", [wire, { encoding: "base64", skipPreflight: false, preflightCommitment: "finalized", maxRetries: 0 }]); },
        }, submit);
      });
      console.log(JSON.stringify({ owner, ...outcome }));
    } catch (error) {
      console.error(JSON.stringify({ owner, error: error instanceof Error ? error.message : "Reporter failure" }));
      process.exitCode = 1;
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Reporter failed"); process.exitCode = 1; });
}
