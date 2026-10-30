import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { getAddressDecoder } from "@solana/kit";
import { common } from "../../lib/holding/client.ts";
import { decodeAccount } from "../../lib/holding/codec.ts";

const PROGRAM = "HhJJRPcwABobT6jCEusieGuZxv6XvSKKvU32XyXASVF6";
const SQUADS = "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf";
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const json = value => JSON.stringify(value, (_, v) => typeof v === "bigint" ? String(v) : v, 2);

/** The only HTTP methods this tool can issue are read-only RPC requests. */
export async function capture(directory) {
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  async function read(method, params) {
    assert.ok(["getGenesisHash", "getMultipleAccounts"].includes(method));
    const response = await fetch(rpcUrl, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }).catch(() => { throw new Error("Mainnet snapshot RPC request failed; endpoint omitted"); });
    if (!response.ok) throw new Error(`Mainnet snapshot RPC HTTP ${response.status}; endpoint omitted`);
    const body = await response.json();
    if (body.error) throw new Error(`Mainnet snapshot RPC error ${Number(body.error.code)}; details omitted`);
    return body.result;
  }
  const genesis = await read("getGenesisHash", []);
  assert.equal(genesis, MAINNET_GENESIS, "Snapshot RPC must be Solana mainnet-beta");
  const accountsAt = keys => read("getMultipleAccounts", [keys, { commitment: "finalized", encoding: "base64" }]);
  const headers = await accountsAt([PROGRAM, SQUADS]);
  const programs = headers.value.map((a, i) => {
    assert.equal(a?.owner, "BPFLoaderUpgradeab1e11111111111111111111111");
    const b = Buffer.from(a.data[0], "base64"); assert.equal(b.readUInt32LE(), 2);
    return { address: [PROGRAM, SQUADS][i], programData: getAddressDecoder().decode(b.subarray(4, 36)) };
  });
  const inst = { program: PROGRAM, config: "DfHQkuycFHq78RyjoypbBwdsqi1xNDG6oHHq7vhTbW58",
    coinMint: "JE3HT7SbCgXDQWV6xp3oiiAisDzq4HyZ8wyEVBDCs45Z", dividendMint: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn",
    coinTokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", dividendTokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" };
  const owners = ["HpsRzXK3xWQxD1Px1KoExP5KYWs5gByEu47z6Ne6gDNf", "Ew2JvG8zkz4qrRQg1qzyaUuvi6q4NL5K282BDnBiHygL"];
  const walletAccounts = await Promise.all(owners.map(owner => common(inst, owner)));
  const keys = [...new Set([PROGRAM, SQUADS, ...programs.map(p => p.programData), inst.config,
    "Gwvu6KdaM1YncnidJ8FTL6kta9F9Fb8yAAtnYAgcNiGN", "EcDXPoFSbxsPyqZ9sXtvipjCM4DSmsTKfNGBpiP1VFmr",
    "13KDtmhNtJNuWNtse2y8tVpZqFbCb4mSnyodYNvPBeWJ", "FuqAQwjXwWeN5xAhDN8QCnCrfezmYwnAkQZqUoZEYhRJ",
    "DW1gQTnD9F2aPcEWmsMMQ3pcLFntUtHPgEuB3E1aFAB3", "3zn8h68d68DU3GL7UyWg5EvGPNXmpJUMrHTkuLST69mv",
    inst.coinMint, inst.dividendMint, "SysvarC1ock11111111111111111111111111111111", ...walletAccounts.flatMap(a => Object.values(a))])];
  const raw = await accountsAt(keys);
  const accounts = Object.fromEntries(keys.map((key, i) => [key, raw.value[i]]));
  assert.equal(accounts[inst.config]?.owner, PROGRAM);
  const config = decodeAccount("Config", Buffer.from(accounts[inst.config].data[0], "base64"));
  assert.equal(config.version, 4); assert.equal(config.params.activate_bps, 0); assert.equal(config.params.deactivate_bps, 0);
  assert.ok(config.pending.effective_at > 0n, "A pending public proposal is required for this rehearsal");
  assert.deepEqual(config.pending.params, { ...config.params, activate_bps: 3000, deactivate_bps: 2500, min_stake_bps: 10 });
  assert.equal(config.reserved[0], 0);
  for (const p of programs) {
    const a = accounts[p.programData]; assert.equal(a?.owner, "BPFLoaderUpgradeab1e11111111111111111111111");
    const b = Buffer.from(a.data[0], "base64"); assert.equal(b.readUInt32LE(), 3);
    const elf = b.subarray(45); assert.equal(elf.subarray(0, 4).toString("hex"), "7f454c46");
    p.programDataSha256 = createHash("sha256").update(b).digest("hex");
    p.elfSha256 = createHash("sha256").update(elf).digest("hex");
    p.deployedAtSlot = String(b.readBigUInt64LE(4));
    p.elfFile = p.address === PROGRAM ? "endowment-mainnet.so" : "squads-mainnet.so";
    await fs.writeFile(new URL(p.elfFile, directory), elf);
  }
  const snapshot = { capturedAt: new Date().toISOString(), source: "Solana mainnet-beta RPC; endpoint omitted", genesis,
    commitment: "finalized", slot: raw.context.slot, programs, inst, owners, walletAccounts, accounts, config };
  await fs.writeFile(new URL("snapshot.json", directory), json(snapshot) + "\n");
}
