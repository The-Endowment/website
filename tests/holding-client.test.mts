import assert from "node:assert/strict";
import { test } from "node:test";
import {
  address,
  createNoopSigner,
  getAddressDecoder,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compileTransaction,
  getTransactionEncoder,
  blockhash,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";
import fixture from "./fixtures/holding-chain.json" with { type: "json" };
import { base64ToBytes, parsePool, type Instance } from "../lib/endowment.ts";
import { collectIx, common, holdPda, settleIx, reviewIx, consentIx } from "../lib/holding/client.ts";
import { decodeAccount, encode, concat, schema } from "../lib/holding/codec.ts";
import type { Consent, Receipt, Config } from "../lib/holding/types.ts";
const inst: Instance = {
  program: address(fixture.program),
  config: address(fixture.config),
  coinMint: address(fixture.coinMint),
  dividendMint: address(fixture.dividendMint),
  coinTokenProgram: address(fixture.coinTokenProgram),
  dividendTokenProgram: address(fixture.dividendTokenProgram),
};
const owner = address(fixture.owner);
const bytes = (key: string) =>
  base64ToBytes(
    (fixture.records as Record<string, { data: string[] }>)[key].data[0],
  );

test("holding client matches bytes and privileges produced by Rust/LiteSVM", async () => {
  const consent = decodeAccount<Consent>(
    "CollectionConsent",
    bytes(await holdPda(inst, "consent", owner)),
  );
  const receipt = decodeAccount<Receipt>(
    "PendingCollection",
    bytes(await holdPda(inst, "receipt", owner, 0n)),
  );
  const ix = await collectIx(
    inst,
    owner,
    address(fixture.pool),
    parsePool(bytes(fixture.pool)),
    createNoopSigner(address(fixture.collector)),
    1n,
    {
      consent_epoch: consent.epoch,
      expected_balance: 0n,
      amount: 100n,
      valid_until: receipt.collected_at + 60n,
      evidence_hash: new Uint8Array(32).fill(7),
    },
  );
  assert.deepEqual([...ix.data!], fixture.sweepData);
  assert.deepEqual(
    ix.accounts!.map((a) => ({
      address: a.address,
      writable: (a.role & 1) !== 0,
      signer: (a.role & 2) !== 0,
    })),
    fixture.sweepAccounts,
  );
  assert.equal(receipt.amount, 1000n);
  assert.equal(receipt.release_at - receipt.collected_at, 86400n);
  assert.equal(receipt.refund_at - receipt.collected_at, 259200n);
  const config = decodeAccount<Config>("Config", bytes(inst.config));
  assert.equal(config.version, 3);
});

test("owner and reviewer builders match the current IDL account order", async () => {
  const { registerLandlordIx, resyncBaselineIx, deregisterLandlordIx } = await import("../lib/endowment.ts");
  const signer = createNoopSigner(owner), a = await common(inst, owner);
  const register = await registerLandlordIx(inst, signer, a.dividend_account, a.coin_account);
  assert.deepEqual(register, await consentIx(inst, signer, "register_landlord"));
  assert.deepEqual(await deregisterLandlordIx(inst, signer), await consentIx(inst, signer, "deregister_landlord"));
  const resync = await resyncBaselineIx(inst, signer, a.dividend_account);
  assert.equal(resync.accounts![1].address, a.consent);
  const receipt = decodeAccount<Receipt>("PendingCollection", bytes(await holdPda(inst, "receipt", owner, 0n)));
  const review = await reviewIx(inst, receipt, createNoopSigner(address(fixture.reviewer)), 500n, new Uint8Array(32));
  assert.equal(review.accounts![1].address, inst.config);
  assert.equal(review.accounts!.length, 4);
});
test("refund transaction always uses the original holder, rent payer and treasury", async () => {
  const receipt = decodeAccount<Receipt>(
    "PendingCollection",
    bytes(await holdPda(inst, "receipt", owner, 0n)),
  );
  const ix = await settleIx(inst, receipt, createNoopSigner(owner), false),
    a = await common(inst, owner);
  const named = Object.fromEntries(
    schema.instructions.refund_collection.accounts.map((m, i) => [
      m.name,
      ix.accounts![i].address,
    ]),
  );
  assert.equal(named.refund_account, a.dividend_account);
  assert.equal(named.owner, owner);
  assert.equal(named.rent_recipient, fixture.collector);
  assert.equal(named.pending_vault, a.pending_vault);
  assert.notEqual(named.pending_vault, named.dividend_vault);
  await assert.rejects(() =>
    settleIx(
      inst,
      { ...receipt, config: owner },
      createNoopSigner(owner),
      false,
    ),
  );
});
test("account decoding rejects unknown layouts and preserves amounts above floating-point precision", () => {
  const config = bytes(inst.config);
  assert.throws(() => decodeAccount("Config", config.slice(0, -1)));
  assert.throws(() =>
    decodeAccount("Config", concat(config, Uint8Array.of(0))),
  );
  const consent = {
    config: inst.config,
    owner,
    bump: 1,
    enabled: true,
    epoch: 9007199254740993n,
    next_nonce: 18446744073709551615n,
    started_at: 1n,
  };
  const data = concat(
    Uint8Array.from(schema.accounts.CollectionConsent),
    encode({ defined: { name: "CollectionConsent" } }, consent),
  );
  assert.deepEqual(decodeAccount("CollectionConsent", data), consent);
  assert.throws(() => encode("u64", 18446744073709551616n));
  assert.throws(() => encode("u64", 9007199254740993));
});

test("dashboard and keeper read the new config without shifting allowance/count fields", async () => {
  const {
    decodeConfig,
    decodeLandlord,
    landlordPda,
    countLandlordsIx,
    refreshLandlordsIx,
    buybackIx,
  } = await import("../lib/endowment.ts");
  const raw = decodeAccount<Record<string, unknown>>(
    "Config",
    bytes(inst.config),
  );
  const config = decodeConfig(bytes(inst.config))!;
  assert.equal(config.holding, true);
  assert.equal(config.contributionCap, raw.contribution_cap);
  assert.equal(config.totalSwept, 1000n);
  assert.equal(config.pool, fixture.pool);
  assert.equal(config.count.round, (raw.count as { round: bigint }).round);
  assert.equal(
    config.pendingEffectiveAt,
    (raw.pending as { effective_at: bigint }).effective_at,
  );
  const landlord = await landlordPda(inst.program, inst.config, owner);
  const record = decodeLandlord(bytes(landlord))!;
  assert.equal(record.holding, true);
  assert.equal(record.totalContributed, 1000n);
  const count = await countLandlordsIx(inst, [{ address: landlord, record }]);
  assert.equal(count.accounts!.length, 5);
  assert.equal(
    count.accounts![4].address,
    await holdPda(inst, "consent", owner),
  );
  const refresh = await refreshLandlordsIx(inst, createNoopSigner(owner), [
    { address: landlord, record },
  ]);
  assert.equal(refresh.accounts!.length, 6);
  assert.equal(
    refresh.accounts![5].address,
    await holdPda(inst, "consent", owner),
  );
  const a = await common(inst, owner);
  const buy = await buybackIx(
    inst,
    address(fixture.pool),
    parsePool(bytes(fixture.pool)),
    createNoopSigner(owner),
    a.dividend_account,
    0n,
  );
  assert.equal(
    buy.accounts!.length,
    schema.instructions.buyback.accounts.length,
  );
  schema.instructions.buyback.accounts.forEach((m, i) => {
    assert.equal((buy.accounts![i].role & 1) !== 0, !!m.writable);
    assert.equal((buy.accounts![i].role & 2) !== 0, !!m.signer);
  });
  assert.equal(buy.accounts![17].address, inst.dividendTokenProgram);
});

test("six-holder count and refresh fit one Solana packet without lookup tables", async () => {
  const { decodeLandlord, landlordPda, countLandlordsIx, refreshLandlordsIx } =
    await import("../lib/endowment.ts");
  const template = decodeLandlord(
    bytes(await landlordPda(inst.program, inst.config, owner)),
  )!;
  const rows = await Promise.all(
    Array.from({ length: 6 }, async (_, i) => {
      const holder = getAddressDecoder().decode(new Uint8Array(32).fill(i + 1));
      const accounts = await common(inst, holder);
      return {
        address: accounts.landlord,
        record: {
          ...template,
          owner: holder,
          coinAccount: accounts.coin_account,
          dividendAccount: accounts.dividend_account,
        },
      };
    }),
  );
  const ixs = [
    await countLandlordsIx(inst, rows),
    await refreshLandlordsIx(inst, createNoopSigner(owner), rows),
  ];
  for (const ix of ixs) {
    const message = appendTransactionMessageInstructions(
      [getSetComputeUnitLimitInstruction({ units: 185000 }), ix],
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: blockhash("11111111111111111111111111111111"),
          lastValidBlockHeight: 1n,
        },
        setTransactionMessageFeePayer(
          owner,
          createTransactionMessage({ version: 0 }),
        ),
      ),
    );
    const size = getTransactionEncoder().encode(
      compileTransaction(message),
    ).length;
    assert.ok(size <= 1232, `keeper packet uses ${size} bytes`);
  }
});
