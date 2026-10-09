import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, distributions } from "../lib/reporter/classify.ts";
import { boundary, observe } from "../lib/reporter/ledger.ts";
import { raw, type Distribution, type ParsedTransaction, type SourcePolicy } from "../lib/reporter/types.ts";

const policy: SourcePolicy = { mint: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn", tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", authority: "HuBMeYW3aDn8BH65fo8xxbP4oiexyup8udzKyccgi8Ga", source: "J8vxiGw4gPng3JTN9HoKJs3ioCD5fnjKGDtRHPVGgaGo" };
const account = "WnhwaPaZXDTQ9GXPiZ3NwWpXVtKff15kVCWR7Arhenw", owner = "HpsRzXK3xWQxD1Px1KoExP5KYWs5gByEu47z6Ne6gDNf";
const signature = "2B5BH3rVXuVg7SaQwy8SacbMQg1WKMkTVFTZn8yHq4iixXvTFxwV3kwmN8ryVKbRAu1HMSZAac4gn8m3C6BHvNHi";
const payout: Distribution = { signature, mint: "JE3HT7SbCgXDQWV6xp3oiiAisDzq4HyZ8wyEVBDCs45Z", quoteMint: policy.mint, amountRaw: "100" };
function tx(before = "1000", after = "1100"): ParsedTransaction {
  const balance = (amount: string) => ({ accountIndex: 0, mint: policy.mint, owner, programId: policy.tokenProgram, uiTokenAmount: { amount, decimals: 6 } });
  return { slot: 11, blockTime: 1_800_000_000, transaction: { signatures: [signature], message: {
    accountKeys: [{ pubkey: account, signer: false }, { pubkey: policy.authority, signer: true }],
    instructions: [{ programId: policy.tokenProgram, parsed: { type: "transferChecked", info: {
      source: policy.source, destination: account, authority: policy.authority, mint: policy.mint, tokenAmount: { amount: "100", decimals: 6 },
    } } }],
  } }, meta: { err: null, preTokenBalances: [balance(before)], postTokenBalances: [balance(after)], innerInstructions: [] } };
}
const feed = () => distributions({ data: { recentDistributions: [payout] } });

test("only matching finalized distributor transfers add net credited rewards", () => {
  assert.equal(classify(tx(), account, owner, policy, feed()).amount, "100");
  const fee = classify(tx("1000", "1097"), account, owner, policy, feed());
  assert.equal(fee.kind, "reward"); assert.equal(fee.amount, "97");
});

test("other generating coins paying PUMP qualify; STONK payouts do not", () => {
  const other = { ...payout, mint: owner };
  assert.equal(classify(tx(), account, owner, policy, new Map([[signature, other]])).kind, "reward");
  assert.equal(classify(tx(), account, owner, policy, new Map([[signature, { ...payout, quoteMint: owner }]])).kind, "other");
  const stonk = tx(); stonk.meta!.postTokenBalances[0].mint = owner;
  assert.equal(classify(stonk, account, owner, policy, feed()).kind, "uncertain");
});

test("purchases, missing API batches, wrong sources and unsigned authorities never become rewards", () => {
  assert.equal(classify(tx(), account, owner, policy, new Map()).kind, "other");
  for (const field of ["source", "authority"]) {
    const purchase = tx(); purchase.transaction.message.instructions[0].parsed!.info[field] = owner;
    assert.equal(classify(purchase, account, owner, policy, feed()).kind, "other");
  }
  const unsigned = tx(); unsigned.transaction.message.accountKeys[1].signer = false;
  assert.equal(classify(unsigned, account, owner, policy, feed()).kind, "other");
  assert.equal(classify(tx(), account, owner, policy, new Map([[signature, { ...payout, amountRaw: "101" }]])).kind, "other");
});

test("spending rewards then buying replacements cannot restore eligibility", () => {
  const reward = classify(tx(), account, owner, policy, feed());
  const spent = tx("1100", "1000"); spent.slot = 12; spent.transaction.signatures = ["spent"];
  Object.assign(spent.transaction.message.instructions[0].parsed!.info, { source: account, destination: owner, authority: owner });
  const bought = tx("1000", "1100"); bought.slot = 13; bought.transaction.signatures = ["bought"];
  bought.transaction.message.instructions[0].parsed!.info.source = owner;
  const observations = [reward, classify(spent, account, owner, policy, feed()), classify(bought, account, owner, policy, feed())];
  const result = observe(boundary("consent", 10, "start", "1000"), observations, 13, "1100", "bought");
  assert.equal(result.ledger.eligible, "0");
});

test("initial and inactive balances plus purchases stay excluded", () => {
  const start = boundary("active", 10, "waiting-and-purchased", "1500");
  const eligible = classify(tx("1500", "1600"), account, owner, policy, feed());
  assert.equal(observe(start, [eligible], 11, "1600", signature).ledger.eligible, "100");
});

test("mixed transactions, authority changes, closed accounts and failed transfers fail closed", () => {
  const mixed = tx("1000", "1000");
  mixed.transaction.message.instructions.push({ programId: policy.tokenProgram, parsed: { type: "transfer", info: { source: account, destination: owner, authority: owner, amount: "100" } } });
  assert.equal(classify(mixed, account, owner, policy, feed()).kind, "uncertain");
  const revoked = tx(); revoked.transaction.message.instructions.push({ programId: policy.tokenProgram, parsed: { type: "revoke", info: { source: account, owner } } });
  assert.equal(classify(revoked, account, owner, policy, feed()).kind, "uncertain");
  const closed = tx(); closed.meta!.postTokenBalances = [];
  assert.equal(classify(closed, account, owner, policy, feed()).kind, "uncertain");
  const failed = tx("1000", "1000"); failed.meta!.err = { InstructionError: [0, "x"] };
  assert.equal(classify(failed, account, owner, policy, feed()).kind, "failed");
});

test("duplicates, same-slot ambiguity and balance discontinuity discard uncertain eligibility", () => {
  const reward = classify(tx(), account, owner, policy, feed());
  const start = boundary("consent", 10, "start", "1000");
  for (const rows of [[reward, reward], [{ ...reward, before: "999" }], [{ ...reward, slot: 10 }], [reward, { ...reward, signature: "another", before: "1100", after: "1200" }]]) {
    assert.equal(observe(start, rows, 12, "1200", "new").ledger.eligible, "0");
  }
});

test("amount and API validation preserve exact integers and reject malformed/conflicting data", () => {
  assert.equal(raw("9007199254740993"), 9007199254740993n);
  for (const invalid of [100, "1.2", "-1", "01", "18446744073709551616"]) assert.throws(() => raw(invalid));
  assert.throws(() => distributions({ data: {} }));
  assert.throws(() => distributions({ data: { recentDistributions: [payout, { ...payout, amountRaw: "99" }] } }));
});


test("PENIS-only holding policy excludes other coins and preserves wallet arrival time", () => {
  const narrow = { ...policy, rewardMint: payout.mint };
  assert.equal(classify(tx(), account, owner, narrow, feed()).kind, "reward");
  assert.equal(classify(tx(), account, owner, narrow, feed()).receivedAt, 1_800_000_000);
  assert.equal(classify(tx(), account, owner, narrow, new Map([[signature, { ...payout, mint: owner }]])).kind, "other");
});

test("scoped feeds accept shared transaction signatures across generating coins and quote tokens", () => {
  const otherCoin = { ...payout, mint: owner, amountRaw: "200" };
  const otherQuote = { ...payout, quoteMint: owner, amountRaw: "300" };
  const scope = { mint: payout.mint, quoteMint: policy.mint };
  for (const rows of [[otherCoin, payout, otherQuote], [otherQuote, payout, otherCoin]]) {
    assert.deepEqual([...distributions({ data: { recentDistributions: rows } }, scope).values()], [payout]);
  }
  assert.equal(distributions({ data: { recentDistributions: [otherCoin, otherQuote] } }, scope).size, 0);
  assert.throws(() => distributions({ data: { recentDistributions: [payout, otherCoin] } }), /Conflicting distribution record/);
});

test("scoped feeds deduplicate core records but still reject relevant conflicts and malformed data", () => {
  const scope = { mint: payout.mint, quoteMint: policy.mint };
  const rows = [{ ...payout, distributedAt: "2026-10-09T12:00:00Z" },
    { ...payout, distributedAt: "2026-10-09T12:00:01Z", holderCount: 7 }];
  assert.deepEqual([...distributions({ data: { recentDistributions: rows } }, scope).values()], [payout]);
  assert.throws(() => distributions({ data: { recentDistributions: [payout, { ...payout, amountRaw: "99" }] } }, scope), /Conflicting distribution record/);
  for (const malformed of [{ ...payout, amountRaw: "1.5" }, { ...payout, signature: "bad" }, null]) {
    assert.throws(() => distributions({ data: { recentDistributions: [malformed] } }, scope));
  }
});

test("mixed coin PUMP payouts in one transaction never authorize the combined payout as PENIS rewards", () => {
  const scoped = distributions({ data: { recentDistributions: [payout,
    { ...payout, mint: owner, amountRaw: "50" }] } }, { mint: payout.mint, quoteMint: policy.mint });
  for (const destination of [account, owner]) {
    const mixed = tx("1000", destination === account ? "1150" : "1100");
    mixed.transaction.message.instructions.push({ programId: policy.tokenProgram, parsed: {
      type: "transferChecked", info: { source: policy.source, destination, authority: policy.authority,
        mint: policy.mint, tokenAmount: { amount: "50", decimals: 6 } },
    } });
    const result = classify(mixed, account, owner, { ...policy, rewardMint: payout.mint }, scoped);
    assert.equal(result.kind, "other");
    assert.equal(result.amount, "0");
  }
});
