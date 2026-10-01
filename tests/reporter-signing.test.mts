import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { address, generateKeyPair, getAddressFromPublicKey, getTransactionDecoder } from "@solana/kit";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { decodeConfig, PENIS_MINT, PUMP_MINT, type Instance } from "../lib/endowment.ts";
import { prepareCollection } from "../lib/reporter/sign.ts";
import { REWARD_DISC } from "../lib/reporter/discriminators.ts";
import type { ChainSnapshot } from "../lib/reporter/snapshot.ts";
import { idlAccount } from "./helpers/idldata.ts";

test("real ephemeral signer creates only the bounded collection transaction; nothing is broadcast", async () => {
  const keys = await generateKeyPair(true);
  const secret = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey)).slice(-32);
  const publicBytes = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  const keyBytes = new Uint8Array(64); keyBytes.set(secret); keyBytes.set(publicBytes, 32);
  const reporter = await getAddressFromPublicKey(keys.publicKey);
  const owner = address("HpsRzXK3xWQxD1Px1KoExP5KYWs5gByEu47z6Ne6gDNf");
  const inst: Instance = { program: address("5VBiPX39xFTgwRaUbC3F3HCuVcM3VkTuYDkxwrhYby2u"), config: owner, coinMint: PENIS_MINT, dividendMint: PUMP_MINT, coinTokenProgram: TOKEN_2022_PROGRAM_ADDRESS, dividendTokenProgram: TOKEN_2022_PROGRAM_ADDRESS };
  const calls: string[] = [];
  const requests: unknown[][] = [];
  const server = createServer(async (request, response) => {
    const parts: Buffer[] = []; for await (const chunk of request) parts.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(parts).toString()) as { method: string; id: string; params: unknown[] };
    calls.push(body.method);
    requests.push(body.params);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { context: { slot: 100 }, value: { blockhash: owner, lastValidBlockHeight: 200 } } }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const endpoint = server.address(); assert.ok(endpoint && typeof endpoint === "object");
    const snapshot: ChainSnapshot = { binding: "test", slot: 100, now: 1_800_000_000, active: true, reason: "test", balance: "1000", nonce: "2", allowance: "999999", capacity: "999999", consentId: "7", collectionEpoch: "8", reporterEpoch: "9", reporter,
      config: decodeConfig(idlAccount("Config", { version: 4, pool: owner }))!, pool: { ammConfig: owner, vaults: [PUMP_MINT, PENIS_MINT], mints: [PUMP_MINT, PENIS_MINT], lpMint: owner, observation: owner } };
    const hash = "ab".repeat(32);
    const prepared = await prepareCollection(`http://127.0.0.1:${endpoint.port}`, keyBytes, inst, owner, snapshot, 100n, hash);
    assert.equal(prepared.nonce, "3"); assert.equal(prepared.amount, "100"); assert.equal(prepared.expiresAt, snapshot.now + 90);
    const transaction = getTransactionDecoder().decode(Buffer.from(prepared.wire, "base64"));
    const signature = transaction.signatures[reporter]; assert.ok(signature);
    assert.equal(await crypto.subtle.verify("Ed25519", keys.publicKey, new Uint8Array(signature), new Uint8Array(transaction.messageBytes)), true);
    const message = Buffer.from(transaction.messageBytes);
    const position = message.indexOf(Buffer.from(REWARD_DISC.collect_reward)); assert.ok(position >= 0);
    assert.equal(message.readBigUInt64LE(position + 8), 7n);
    assert.equal(message.readBigUInt64LE(position + 16), 3n);
    assert.equal(message.readBigUInt64LE(position + 40), 100n);
    assert.equal(message.subarray(position + 72, position + 104).toString("hex"), hash);
    assert.deepEqual(calls, ["getLatestBlockhash"]);
    const request = requests[0][0] as { commitment?: string; minContextSlot: number };
    // Kit omits the RPC default commitment (finalized) on the wire.
    assert.equal(request.commitment ?? "finalized", "finalized");
    assert.equal(request.minContextSlot, 100);
    await assert.rejects(prepareCollection(`http://127.0.0.1:${endpoint.port}`, keyBytes, inst, owner, { ...snapshot, reporter: owner }, 100n, hash), /configured reporter/);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
