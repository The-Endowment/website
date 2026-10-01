import { mkdir, open, readFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { address, getBase58Decoder } from "@solana/kit";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import {
  base64ToBytes,
  flagshipConfig,
  PROGRAM_ID,
  PENIS_MINT,
  PUMP_MINT,
  type Instance,
} from "../lib/endowment.ts";
import { jsonRpc } from "../lib/reporter/rpc.ts";
import { archiveFeed } from "../lib/holding/feed.ts";
import { decodeAccount, schema } from "../lib/holding/codec.ts";
import { pendingReceipts } from "../lib/holding/snapshot.ts";
import { walletTick } from "../lib/holding/worker.ts";
import type { Consent } from "../lib/holding/types.ts";
import { HOLD_COLLECTION_RELEASED } from "../lib/holding/release.ts";

async function main() {
  const role = process.argv.find((a) => a.startsWith("--role="))?.split("=")[1];
  const submit = process.argv.includes("--submit");
  if (role !== "collector" && role !== "reviewer")
    throw new Error("Use --role=collector or --role=reviewer");
  if (submit && !HOLD_COLLECTION_RELEASED)
    throw new Error(
      "Draft release hold: submission requires a reviewed rollout",
    );
  const rpcUrl = process.env.SOLANA_RPC_URL,
    data = process.env.HOLD_DATA_DIR,
    config = await flagshipConfig();
  if (!rpcUrl || !data || !PROGRAM_ID || !config)
    throw new Error(
      "Set reviewed flagship configuration, SOLANA_RPC_URL, and a durable HOLD_DATA_DIR",
    );
  const directory = resolve(data);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, "worker.lock");
  await mkdir(lock);
  try {
    const roleFile = join(directory, "role");
    try {
      if ((await readFile(roleFile, "utf8")) !== role)
        throw new Error(
          "Collector and reviewer must not share their data directory",
        );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      const file = await open(roleFile, "wx", 0o600);
      try {
        await file.writeFile(role);
        await file.sync();
      } finally {
        await file.close();
      }
    }
    const rpc = jsonRpc(rpcUrl);
    const inst: Instance = {
      program: PROGRAM_ID,
      config,
      coinMint: PENIS_MINT,
      dividendMint: PUMP_MINT,
      coinTokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      dividendTokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    };
    const feed = await archiveFeed(directory).catch((error) => {
      if (role === "collector") throw error;
      console.error(
        "Reviewer feed unavailable: no new rewards credited; existing receipts can still be refunded.",
      );
      return new Map();
    });
    const receipts = await pendingReceipts(rpc, inst);
    const rows = await rpc<
      { account: { owner: string; data: [string, string] } }[]
    >("getProgramAccounts", [
      inst.program,
      {
        encoding: "base64",
        commitment: "finalized",
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: getBase58Decoder().decode(
                Uint8Array.from(schema.accounts.CollectionConsent),
              ),
            },
          },
          { memcmp: { offset: 8, bytes: config } },
        ],
      },
    ]);
    const owners = new Set(receipts.map((r) => r.receipt.owner));
    for (const row of rows) {
      if (row.account.owner !== inst.program)
        throw new Error("Wrong consent program");
      const consent = decodeAccount<Consent>(
        "CollectionConsent",
        base64ToBytes(row.account.data[0]),
      );
      if (consent.config !== config) throw new Error("Wrong consent config");
      if (consent.enabled) owners.add(consent.owner);
    }
    for (const owner of [...owners].sort()) {
      try {
        const result = await walletTick(
          {
            rpc,
            rpcUrl,
            inst,
            directory,
            submit,
            role,
            feed,
            keyFile: process.env.HOLD_KEYPAIR_FILE,
            source: {
              mint: PUMP_MINT,
              rewardMint: PENIS_MINT,
              tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
              authority: "HuBMeYW3aDn8BH65fo8xxbP4oiexyup8udzKyccgi8Ga",
              source: "J8vxiGw4gPng3JTN9HoKJs3ioCD5fnjKGDtRHPVGgaGo",
            },
          },
          address(owner),
          receipts.filter((r) => r.receipt.owner === owner),
        );
        console.log(JSON.stringify({ role, owner, ...result }));
      } catch (e) {
        console.error(
          JSON.stringify({
            role,
            owner,
            error: e instanceof Error ? e.message : "Worker failed",
          }),
        );
        process.exitCode = 1;
      }
    }
  } finally {
    await rm(lock, { recursive: true });
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Worker failed");
  process.exitCode = 1;
});
