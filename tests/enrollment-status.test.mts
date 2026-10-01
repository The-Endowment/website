import assert from "node:assert/strict";
import { test } from "node:test";
import { address, createNoopSigner, getAddressEncoder, type Address } from "@solana/kit";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { ata, authorityPda, DISC, landlordPda, PENIS_MINT, PUMP_MINT, type Instance } from "../lib/endowment.ts";
import { loadEnrollmentDetails, loadExitStatus, ownerExitInstructions } from "../lib/enrollment-status.ts";
import { reporterPolicyPda } from "../lib/reward-client.ts";
import { idlAccount } from "./helpers/idldata.ts";

const owner = address("HpsRzXK3xWQxD1Px1KoExP5KYWs5gByEu47z6Ne6gDNf");
const other = address("HuBMeYW3aDn8BH65fo8xxbP4oiexyup8udzKyccgi8Ga");
const program = address("5VBiPX39xFTgwRaUbC3F3HCuVcM3VkTuYDkxwrhYby2u");
const inst: Instance = { program, config: address("J8vxiGw4gPng3JTN9HoKJs3ioCD5fnjKGDtRHPVGgaGo"), coinMint: PENIS_MINT, dividendMint: PUMP_MINT, coinTokenProgram: TOKEN_2022_PROGRAM_ADDRESS, dividendTokenProgram: TOKEN_2022_PROGRAM_ADDRESS };
const signer = createNoopSigner(owner);
const keyBytes = (key: Address) => new Uint8Array(getAddressEncoder().encode(key));
type Account = { owner: Address; data: [string, string]; lamports: bigint; executable: boolean; rentEpoch: bigint };
const account = (data: Uint8Array, owner: Address = program): Account => ({ owner, data: [Buffer.from(data).toString("base64"), "base64"], lamports: 1n, executable: false, rentEpoch: 0n });

function token(mint: Address, holder: Address, delegate?: Address, allowance = (1n << 64n) - 1n) {
  const data = Buffer.alloc(165);
  data.set(keyBytes(mint)); data.set(keyBytes(holder), 32); data.writeBigUInt64LE(500n, 64); data[108] = 1;
  if (delegate) { data.writeUInt32LE(1, 72); data.set(keyBytes(delegate), 76); data.writeBigUInt64LE(allowance, 121); }
  return account(data, TOKEN_2022_PROGRAM_ADDRESS);
}

async function fixture() {
  const authority = await authorityPda(program, inst.config);
  const source = await ata(owner, PUMP_MINT, TOKEN_2022_PROGRAM_ADDRESS);
  const coin = await ata(owner, PENIS_MINT, TOKEN_2022_PROGRAM_ADDRESS);
  const landlord = await landlordPda(program, inst.config, owner);
  const direct = await ata(authority, PENIS_MINT, TOKEN_2022_PROGRAM_ADDRESS);
  const policy = await reporterPolicyPda(inst);
  const record = { version: 4, config: inst.config, owner, dividend_account: source, coin_account: coin };
  const mint = Buffer.alloc(82); mint.writeBigUInt64LE(1_000_000_000n, 36); mint[44] = 6; mint[45] = 1;
  const accounts = new Map<Address, Account | Error | null>([
    [source, token(PUMP_MINT, owner, authority)], [landlord, account(idlAccount("Landlord", record))],
    [coin, token(PENIS_MINT, owner)], [direct, token(PENIS_MINT, authority)], [PENIS_MINT, account(mint, TOKEN_2022_PROGRAM_ADDRESS)],
    [inst.config, account(idlAccount("Config", { version: 4, coin_mint: PENIS_MINT, dividend_mint: PUMP_MINT }))],
    [policy, account(idlAccount("ReporterPolicy", { config: inst.config, reporter: other }))],
  ]);
  const calls: Address[] = [];
  const rpc = { getAccountInfo: (key: Address) => ({ send: async () => {
    calls.push(key);
    const value = accounts.get(key) ?? null;
    if (value instanceof Error) throw value;
    return { context: { slot: 1n }, value };
  } }) };
  return { rpc, accounts, calls, authority, source, coin, landlord, direct, policy, record };
}

function assertRevoke(ix: Awaited<ReturnType<typeof ownerExitInstructions>>[number], source: Address) {
  assert.equal(ix.programAddress, TOKEN_2022_PROGRAM_ADDRESS);
  assert.deepEqual([...ix.data!], [5]);
  assert.equal(ix.accounts![0].address, source);
  assert.equal(ix.accounts![1].address, owner);
}
function assertDeregister(ix: Awaited<ReturnType<typeof ownerExitInstructions>>[number], landlord: Address) {
  assert.equal(ix.programAddress, program);
  assert.deepEqual([...ix.data!], DISC.deregisterLandlord);
  assert.deepEqual(ix.accounts!.map((entry) => entry.address), [owner, inst.config, landlord]);
}

test("reporter, config, coin, mint and vault RPC/decode failures cannot block verified owner exit", async () => {
  for (const dependency of ["policy", "config", "coin", "mint", "direct"] as const) {
    for (const failure of ["rpc", "malformed"] as const) {
      const f = await fixture();
      const key = dependency === "config" ? inst.config : dependency === "mint" ? PENIS_MINT : f[dependency];
      const before = f.accounts.get(key) as Account;
      f.accounts.set(key, failure === "rpc" ? new Error("Injected network failure") : { ...before, data: [Buffer.from(before.data[0], "base64").subarray(0, 9).toString("base64"), "base64"] });
      const [exit, details] = await Promise.allSettled([loadExitStatus(f.rpc, inst, owner), loadEnrollmentDetails(f.rpc, inst, owner)]);
      assert.equal(exit.status, "fulfilled", `${dependency}/${failure}: exit remains available`);
      assert.equal(details.status, "rejected", `${dependency}/${failure}: joining fails closed`);
      const exitCalls: Address[] = [];
      const exitRpc = { getAccountInfo: (key: Address) => { exitCalls.push(key); return f.rpc.getAccountInfo(key); } };
      const ixs = await ownerExitInstructions(exitRpc, inst, signer);
      assert.equal(ixs.length, 2); assertRevoke(ixs[0], f.source); assertDeregister(ixs[1], f.landlord);
      assert.deepEqual(new Set(exitCalls), new Set([f.source, f.landlord]), "Signing exit reads no optional dependency");
    }
  }
});

test("reporter/lifecycle reads that never resolve do not delay the separate exit read", async () => {
  const f = await fixture();
  const rpc = { getAccountInfo: (key: Address) => key === f.policy ? { send: () => new Promise<never>(() => {}) } : f.rpc.getAccountInfo(key) };
  void loadEnrollmentDetails(rpc, inst, owner);
  const exit = await loadExitStatus(rpc, inst, owner);
  assert.equal(exit.delegatedToEndowment, true); assert.ok(exit.landlord);
  assert.equal((await ownerExitInstructions(rpc, inst, signer)).length, 2);
});

test("Leave refreshes a replaced delegation and preserves the other app's current approval", async () => {
  const f = await fixture();
  assert.equal((await loadExitStatus(f.rpc, inst, owner)).delegatedToEndowment, true);
  f.accounts.set(f.source, token(PUMP_MINT, owner, other));
  const ixs = await ownerExitInstructions(f.rpc, inst, signer);
  assert.equal(ixs.length, 1); assertDeregister(ixs[0], f.landlord);
  f.accounts.set(f.landlord, null);
  await assert.rejects(ownerExitInstructions(f.rpc, inst, signer), /No verified endowment approval or enrollment/);
});

test("one failed core read permits only the independently verified action; two failures refuse exit", async () => {
  for (const failed of ["landlord", "source"] as const) {
    const f = await fixture(); f.accounts.set(f[failed], new Error("Injected core failure"));
    const exit = await loadExitStatus(f.rpc, inst, owner);
    assert.equal(exit.readErrors.length, 1);
    const ixs = await ownerExitInstructions(f.rpc, inst, signer);
    assert.equal(ixs.length, 1);
    if (failed === "landlord") assertRevoke(ixs[0], f.source); else assertDeregister(ixs[0], f.landlord);
    f.accounts.set(f[failed === "landlord" ? "source" : "landlord"], new Error("Other core failure"));
    await assert.rejects(ownerExitInstructions(f.rpc, inst, signer), /Couldn't verify either/);
  }
});

test("unrelated owners, instances, token accounts and program owners never authorize an exit action", async () => {
  for (const patch of [{ owner: other }, { config: other }, { dividend_account: other }, { coin_account: other }]) {
    const f = await fixture(); f.accounts.set(f.landlord, account(idlAccount("Landlord", { ...f.record, ...patch })));
    const ixs = await ownerExitInstructions(f.rpc, inst, signer);
    assert.equal(ixs.length, 1); assertRevoke(ixs[0], f.source);
  }
  for (const brokenToken of [token(PUMP_MINT, other), token(PENIS_MINT, owner), { ...token(PUMP_MINT, owner), owner: other }]) {
    const f = await fixture(); f.accounts.set(f.source, brokenToken);
    const ixs = await ownerExitInstructions(f.rpc, inst, signer);
    assert.equal(ixs.length, 1); assertDeregister(ixs[0], f.landlord);
  }
  const f = await fixture(); f.accounts.set(f.landlord, account(idlAccount("Landlord", f.record), other));
  const ixs = await ownerExitInstructions(f.rpc, inst, signer);
  assert.equal(ixs.length, 1); assertRevoke(ixs[0], f.source);
});

test("a small endowment approval can be revoked without an enrollment record", async () => {
  const f = await fixture(); f.accounts.set(f.landlord, null); f.accounts.set(f.source, token(PUMP_MINT, owner, f.authority, 1n));
  const exit = await loadExitStatus(f.rpc, inst, owner);
  assert.equal(exit.delegatedToEndowment, false); assert.equal(exit.delegationTooSmall, true);
  const ixs = await ownerExitInstructions(f.rpc, inst, signer);
  assert.equal(ixs.length, 1); assertRevoke(ixs[0], f.source);
});
