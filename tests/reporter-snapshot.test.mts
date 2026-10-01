import assert from "node:assert/strict";
import { test } from "node:test";
import { address, getAddressEncoder, type Address } from "@solana/kit";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { ACTIVE_MAX_AGE_SECS, ata, authorityPda, CPMM_PROGRAM, KNOWN_PROGRAM_IDS, PENIS_MINT, PUMP_MINT, type Instance } from "../lib/endowment.ts";
import { chainSnapshot } from "../lib/reporter/snapshot.ts";
import type { RpcCall } from "../lib/reporter/rpc.ts";
import { raw } from "../lib/reporter/types.ts";
import { idlAccount } from "./helpers/idldata.ts";

const U64_MAX = (1n << 64n) - 1n;
const owner = address("HpsRzXK3xWQxD1Px1KoExP5KYWs5gByEu47z6Ne6gDNf");
const reporter = address("HuBMeYW3aDn8BH65fo8xxbP4oiexyup8udzKyccgi8Ga");
const program = address(KNOWN_PROGRAM_IDS[0]);
const inst: Instance = { program, config: address("J8vxiGw4gPng3JTN9HoKJs3ioCD5fnjKGDtRHPVGgaGo"), coinMint: PENIS_MINT, dividendMint: PUMP_MINT, coinTokenProgram: TOKEN_2022_PROGRAM_ADDRESS, dividendTokenProgram: TOKEN_2022_PROGRAM_ADDRESS };
const encodedAddress = (key: Address) => new Uint8Array(getAddressEncoder().encode(key));
type Account = { owner: string; data: [string, string] };
const account = (data: Uint8Array, owner: string = program): Account => ({ owner, data: [Buffer.from(data).toString("base64"), "base64"] });

function token(mint: Address, owner: Address, amount: bigint, delegate?: Address): Uint8Array {
  const data = Buffer.alloc(165);
  data.set(encodedAddress(mint)); data.set(encodedAddress(owner), 32); data.writeBigUInt64LE(amount, 64);
  if (delegate) { data.writeUInt32LE(1, 72); data.set(encodedAddress(delegate), 76); data.writeBigUInt64LE(U64_MAX, 121); }
  data[108] = 1;
  return data;
}

async function fixture(configPatch: Record<string, unknown> = {}, paramsPatch: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1_000), slot = 100;
  const authority = await authorityPda(inst.program, inst.config);
  const source = await ata(owner, inst.dividendMint, inst.dividendTokenProgram);
  const config = { version: 4, coin_mint: PENIS_MINT, dividend_mint: PUMP_MINT, pool: reporter,
    params: { max_buy_per_tx: 100n, max_buy_per_day: 1_000n, min_buy_interval_secs: 86_400n, activate_bps: 3_000, ...paramsPatch },
    active: true, contribution_cap: 200_000_000_000_000n, last_count_at: now, collection_epoch: 7n, ...configPatch };
  const landlord = { version: 4, config: inst.config, owner, dividend_account: source, consent_id: 12n, last_report_nonce: 3n };
  const policy = { config: inst.config, reporter, epoch: 4n };
  const pool = Buffer.alloc(328); pool.set(encodedAddress(PUMP_MINT), 168); pool.set(encodedAddress(PENIS_MINT), 200);
  const clock = Buffer.alloc(40); clock.writeBigInt64LE(BigInt(now), 32);
  const accounts: (Account | null)[] = [account(idlAccount("Config", config)), account(idlAccount("Landlord", landlord)),
    account(idlAccount("ReporterPolicy", policy)), account(token(PUMP_MINT, owner, 5_000n, authority), TOKEN_2022_PROGRAM_ADDRESS),
    account(token(PUMP_MINT, authority, 25n), TOKEN_2022_PROGRAM_ADDRESS), account(token(PENIS_MINT, authority, 1n), TOKEN_2022_PROGRAM_ADDRESS),
    account(pool, CPMM_PROGRAM), account(clock, "Sysvar1111111111111111111111111111111111111")];
  const calls: { method: string; params: unknown[] }[] = [];
  const rpc: RpcCall = async <T,>(method: string, params: unknown[]): Promise<T> => {
    calls.push({ method, params });
    if (method === "getAccountInfo") return { value: accounts[0] } as T;
    assert.equal(method, "getMultipleAccounts");
    return { context: { slot }, value: accounts } as T;
  };
  return { rpc, accounts, config, landlord, policy, now, slot, authority, source, calls };
}

test("snapshot decodes generated version 4 layouts and binds consent, balances and lifecycle to one finalized bank", async () => {
  const f = await fixture(); const state = await chainSnapshot(f.rpc, inst, owner, 99);
  assert.equal(state.active, true); assert.equal(state.balance, "5000"); assert.equal(state.allowance, U64_MAX.toString());
  assert.equal(state.capacity, "275"); assert.equal(state.nonce, "3"); assert.equal(state.consentId, "12");
  assert.equal(state.collectionEpoch, "7"); assert.equal(state.reporterEpoch, "4"); assert.equal(state.reporter, reporter);
  assert.equal(state.binding, [inst.config, owner, f.source, 12, 7, 4].join(":"));
  assert.deepEqual(f.calls[1].params[1], { encoding: "base64", commitment: "finalized", minContextSlot: 99 });
});

test("treasury capacity saturates at u64::MAX like Rust and remains acceptable to report amount parsing", async () => {
  for (const [perTx, perDay, interval, cap] of [
    [U64_MAX, U64_MAX, 1n, U64_MAX], [U64_MAX, U64_MAX / 3n - 1n, 1n, U64_MAX - 3n], [U64_MAX, U64_MAX / 3n, 1n, U64_MAX],
    [U64_MAX, U64_MAX / 3n + 1n, 1n, U64_MAX], [U64_MAX, 20n, 1n, 60n],
    [2n, U64_MAX, 86_400n, 6n], [2n, U64_MAX, 0n, 518_400n], [2n, U64_MAX, -1n, 518_400n],
  ]) {
    const f = await fixture({}, { max_buy_per_tx: perTx, max_buy_per_day: perDay, min_buy_interval_secs: interval });
    for (const held of [0n, 1n, cap, U64_MAX]) {
      f.accounts[4] = account(token(PUMP_MINT, f.authority, held), TOKEN_2022_PROGRAM_ADDRESS);
      const state = await chainSnapshot(f.rpc, inst, owner);
      assert.equal(raw(state.capacity), cap > held ? cap - held : 0n);
    }
  }
});

test("snapshot rejects wrong account program owners and encoding before any report can be signed", async () => {
  for (let index = 0; index < 8; index++) {
    const f = await fixture(); f.accounts[index]!.owner = owner;
    await assert.rejects(chainSnapshot(f.rpc, inst, owner), /Account owner or encoding mismatch/);
  }
  const f = await fixture(); f.accounts[3]!.data[1] = "jsonParsed";
  await assert.rejects(chainSnapshot(f.rpc, inst, owner), /Account owner or encoding mismatch/);
});

test("snapshot rejects old versions and mismatched consent or policy instances", async () => {
  for (const [index, name, patch] of [
    [0, "Config", { version: 3 }], [0, "Config", { coin_mint: PUMP_MINT }], [0, "Config", { dividend_mint: PENIS_MINT }],
    [1, "Landlord", { version: 3 }], [1, "Landlord", { owner: reporter }], [1, "Landlord", { config: reporter }],
    [1, "Landlord", { dividend_account: reporter }], [2, "ReporterPolicy", { config: reporter }],
  ] as const) {
    const f = await fixture(); const data = index === 0 ? f.config : index === 1 ? f.landlord : f.policy;
    f.accounts[index] = account(idlAccount(name, { ...data, ...patch }));
    await assert.rejects(chainSnapshot(f.rpc, inst, owner), /Unrecognized version, instance, or reward consent|Unknown config account/);
  }
});

test("snapshot rejects source or vault token identities that differ from the configured accounts", async () => {
  for (const index of [3, 4, 5]) {
    for (const corrupt of ["mint", "owner"]) {
      const f = await fixture(); const mint = index === 5 ? PENIS_MINT : PUMP_MINT;
      const holder = index === 3 ? owner : f.authority;
      f.accounts[index] = account(token(corrupt === "mint" ? reporter : mint, corrupt === "owner" ? reporter : holder, 100n, f.authority), TOKEN_2022_PROGRAM_ADDRESS);
      await assert.rejects(chainSnapshot(f.rpc, inst, owner), /Token account identity mismatch/);
    }
  }
});

test("completion, missing consent, delegation removal, disabled reporter and inactive lifecycle all stop collection", async () => {
  const now = Math.floor(Date.now() / 1_000);
  for (const patch of [{ milestone_reached: true }, { retired: true }, { active: false }, { paused_until: now + 3_600 }, { last_count_at: now - ACTIVE_MAX_AGE_SECS - 10 }]) {
    const f = await fixture(patch); assert.equal((await chainSnapshot(f.rpc, inst, owner)).active, false);
  }
  for (const scenario of ["consent", "source", "delegation", "disabled", "goal"]) {
    const f = await fixture();
    if (scenario === "consent") f.accounts[1] = null;
    if (scenario === "source") f.accounts[3] = null;
    if (scenario === "delegation") f.accounts[3] = account(token(PUMP_MINT, owner, 5_000n), TOKEN_2022_PROGRAM_ADDRESS);
    if (scenario === "disabled") f.accounts[2] = account(idlAccount("ReporterPolicy", { ...f.policy, disabled: true }));
    if (scenario === "goal") f.accounts[5] = account(token(PENIS_MINT, f.authority, f.config.contribution_cap), TOKEN_2022_PROGRAM_ADDRESS);
    assert.equal((await chainSnapshot(f.rpc, inst, owner)).active, false, scenario);
  }
});
