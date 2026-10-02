import assert from "node:assert/strict";
import { test } from "node:test";
import { address, type Address } from "@solana/kit";
import fixture from "./fixtures/holding-chain.json" with { type: "json" };
import type { Instance } from "../lib/endowment.ts";
import { holdPda } from "../lib/holding/client.ts";
import { loadHolding } from "../lib/holding/wallet.ts";

const inst: Instance = {
  program: address(fixture.program), config: address(fixture.config),
  coinMint: address(fixture.coinMint), dividendMint: address(fixture.dividendMint),
  coinTokenProgram: address(fixture.coinTokenProgram), dividendTokenProgram: address(fixture.dividendTokenProgram),
};
const records = fixture.records as unknown as Record<string, { owner: string; data: [string, string] }>;
/** A read-only RPC over the Rust-generated account bytes; counts the calls. */
function bank(hide: string[] = []) {
  const calls: Address[][] = [];
  const rpc = {
    getMultipleAccounts: (addresses: Address[]) => ({
      send: async () => {
        calls.push(addresses);
        return { value: addresses.map((a) => (hide.includes(a) ? null : (records[a] ?? null))) };
      },
    }),
  };
  return { rpc, calls };
}
const owner = address(fixture.owner);

test("a wallet sees its switch and the collection held for it, in two reads", async () => {
  const { rpc, calls } = bank();
  const holding = await loadHolding(rpc, inst, owner);
  assert.equal(holding.ready, true);
  assert.equal(holding.consent?.enabled, true);
  assert.equal(holding.consent?.next_nonce, 1n);
  assert.equal(holding.receipts.length, 1);
  assert.equal(holding.receipts[0].amount, 1000n);
  assert.equal(holding.receipts[0].owner, owner);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], [await holdPda(inst, "receipt", owner, 0n)]);
});

test("a settled collection is gone, and a wallet that never joined has nothing", async () => {
  const receipt = await holdPda(inst, "receipt", owner, 0n);
  const settled = await loadHolding(bank([receipt]).rpc, inst, owner);
  assert.deepEqual(settled.receipts, []);
  assert.equal(settled.consent?.enabled, true);

  const stranger = address(fixture.reviewer);
  const { rpc, calls } = bank();
  assert.deepEqual(await loadHolding(rpc, inst, stranger), { ready: true, consent: null, receipts: [] });
  assert.equal(calls.length, 1);
});

test("before collection is set up, joining is not offered", async () => {
  const policy = await holdPda(inst, "policy");
  assert.equal((await loadHolding(bank([policy]).rpc, inst, owner)).ready, false);
});

test("another program's account at the same address is ignored", async () => {
  const consent = await holdPda(inst, "consent", owner);
  const rpc = {
    getMultipleAccounts: (addresses: Address[]) => ({
      send: async () => ({
        value: addresses.map((a) => (a === consent ? { ...records[a], owner: fixture.dividendTokenProgram } : (records[a] ?? null))),
      }),
    }),
  };
  assert.equal((await loadHolding(rpc, inst, owner)).consent, null);
});

test("joining, rejoining and taking a collection back each fit one transaction", async () => {
  const kit = await import("@solana/kit");
  const token = await import("@solana-program/token-2022");
  const { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } = await import("@solana-program/compute-budget");
  const { registerLandlordIx, resyncBaselineIx, authorityPda, ata } = await import("../lib/endowment.ts");
  const { consentIx, settleIx } = await import("../lib/holding/client.ts");
  const signer = kit.createNoopSigner(owner);
  const dividendAccount = await ata(owner, inst.dividendMint, inst.dividendTokenProgram);
  const coinAccount = await ata(owner, inst.coinMint, inst.coinTokenProgram);
  const tokenProgram = inst.dividendTokenProgram as typeof token.TOKEN_2022_PROGRAM_ADDRESS;
  // What the Delegate button sends, in order (components/DelegatePanel.tsx).
  const before = [
    token.getCreateAssociatedTokenIdempotentInstruction({ payer: signer, owner, mint: inst.dividendMint, ata: dividendAccount, tokenProgram }),
    token.getCreateAssociatedTokenIdempotentInstruction({ payer: signer, owner, mint: inst.coinMint, ata: coinAccount, tokenProgram }),
    token.getApproveCheckedInstruction(
      { source: dividendAccount, mint: inst.dividendMint, delegate: await authorityPda(inst.program, inst.config), owner: signer, amount: 18446744073709551615n, decimals: 6 },
      { programAddress: tokenProgram },
    ),
  ];
  const enable = await consentIx(inst, signer, "enable_collection");
  const held = (await loadHolding(bank().rpc, inst, owner)).receipts[0];
  const flows = {
    join: [...before, await registerLandlordIx(inst, signer, dividendAccount, coinAccount), enable],
    rejoin: [...before, await resyncBaselineIx(inst, signer, dividendAccount), enable],
    takeBack: [await settleIx(inst, held, signer, false)],
  };
  for (const [name, ixs] of Object.entries(flows)) {
    // Wallets add their own compute-budget instructions; leave room for both.
    const message = kit.appendTransactionMessageInstructions(
      [getSetComputeUnitLimitInstruction({ units: 400_000 }), getSetComputeUnitPriceInstruction({ microLamports: 100_000n }), ...ixs],
      kit.setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: kit.blockhash("11111111111111111111111111111111"), lastValidBlockHeight: 1n },
        kit.setTransactionMessageFeePayer(owner, kit.createTransactionMessage({ version: 0 })),
      ),
    );
    const size = kit.getTransactionEncoder().encode(kit.compileTransaction(message)).length;
    assert.ok(size <= 1232, `${name} uses ${size} bytes`);
  }
});
