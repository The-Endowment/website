import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { address, generateKeyPairSigner } from "@solana/kit";
import { configPda, PENIS_MINT, PROGRAM_FLAGSHIP_CREATOR } from "../lib/endowment.ts";
import type { Config } from "../lib/holding/accounts.ts";
import { concat, decodeAccount, encode, schema } from "../lib/holding/codec.ts";
import fixture from "./fixtures/holding-chain.json" with { type: "json" };

const exec = promisify(execFile);
const script = fileURLToPath(new URL("../scripts/launch.mts", import.meta.url));

test("apply prepares a Squads admin message without pretending to simulate or submitting it", async (t) => {
  const [admin, guardian, refresher] = await Promise.all(Array.from({ length: 3 }, () => generateKeyPairSigner()));
  const configAddress = await configPda(address(schema.address), PENIS_MINT, PROGRAM_FLAGSHIP_CREATOR);
  const config = decodeAccount<Config>("Config", Buffer.from(
    (fixture.records as Record<string, { data: string[] }>)[fixture.config].data[0], "base64"));
  config.admin = admin.address;
  config.guardian = guardian.address;
  config.params.refresher = refresher.address;
  config.pending = { params: { ...config.params, activate_bps: 3000, deactivate_bps: 2500 }, effective_at: 1n };
  const data = Buffer.from(concat(Uint8Array.from(schema.accounts.Config),
    encode({ defined: { name: "Config" } }, config))).toString("base64");
  const methods: string[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    methods.push(request.method);
    const value = request.method === "getLatestBlockhash"
      ? { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1000 }
      : request.params[0] === configAddress
        ? { data: [data, "base64"], owner: schema.address, executable: false, lamports: 1000000, rentEpoch: 0, space: Buffer.from(data, "base64").length }
        : null;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { context: { slot: 1 }, value } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const port = (server.address() as { port: number }).port;
  const env = { ...process.env, SOLANA_RPC_URL: `http://127.0.0.1:${port}` };
  const { stdout } = await exec(process.execPath, [script, "apply-params", "--admin", admin.address], { env });
  assert.match(stdout, /Prepared only: not simulated, submitted, or approved/);
  assert.match(stdout, /Base58 transaction message/);
  assert.match(stdout, new RegExp(`"pubkey": "${admin.address}"`));
  assert.deepEqual(methods, ["getAccountInfo", "getAccountInfo", "getLatestBlockhash"]);
  assert.doesNotMatch(stdout, /Simulation passed|Confirmed:/);

  await assert.rejects(exec(process.execPath, [script, "apply-params", "--admin", admin.address, "--send"], { env }), /prepares instructions only/);
  await assert.rejects(exec(process.execPath, [script, "apply-params", "--admin-key", "unused.json"], { env }), /requires --rehearsal/);
  const wrongAdmin = (await generateKeyPairSigner()).address;
  await assert.rejects(exec(process.execPath, [script, "apply-params", "--admin", wrongAdmin], { env }), /does not match the on-chain admin/);
  assert.ok(methods.every((method) => !["simulateTransaction", "sendTransaction"].includes(method)));
});
