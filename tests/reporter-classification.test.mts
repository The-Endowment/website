import assert from "node:assert/strict";
import { test } from "node:test";
import { walletPayouts, VERIFICATION_VERSION, type WalletPayout, type WalletPayoutFeed } from "../lib/reporter/payouts.ts";
import { classify, distributions } from "../lib/reporter/classify.ts";
import { boundary, observe } from "../lib/reporter/ledger.ts";
import { MissingPayoutEvidence, PAYOUT_EVIDENCE_WAIT_SECONDS, raw, type Distribution, type ParsedTransaction, type SourcePolicy } from "../lib/reporter/types.ts";

const policy: SourcePolicy = { rewardMint: "JE3HT7SbCgXDQWV6xp3oiiAisDzq4HyZ8wyEVBDCs45Z", mint: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn", tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", authority: "HuBMeYW3aDn8BH65fo8xxbP4oiexyup8udzKyccgi8Ga", source: "J8vxiGw4gPng3JTN9HoKJs3ioCD5fnjKGDtRHPVGgaGo" };
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
const holderRow: WalletPayout = {signature, holder: owner, assetMint: policy.mint, amountRaw: "100", createdAt: "2026-10-14T00:00:00Z"};
const feed = (rows: WalletPayout[] = [holderRow], mint = policy.rewardMint!) => walletPayouts(rows, {mint, quoteMint: policy.mint});
const otherAccount = "J".repeat(32), otherOwner = "K".repeat(32);
function addPayout(transaction: ParsedTransaction, destination = otherAccount, wallet = otherOwner, amount = "50") {
  let index = transaction.transaction.message.accountKeys.findIndex(k => k.pubkey === destination);
  if (index < 0) {
    index = transaction.transaction.message.accountKeys.length;
    transaction.transaction.message.accountKeys.push({pubkey: destination, signer: false});
    const balance = (n: string) => ({accountIndex: index, owner: wallet, mint: policy.mint, programId: policy.tokenProgram,
      uiTokenAmount: {amount: n, decimals: 6}});
    transaction.meta!.preTokenBalances.push(balance("0"));
    transaction.meta!.postTokenBalances.push(balance(amount));
  }
  transaction.transaction.message.instructions.push({programId: policy.tokenProgram, parsed: {type: "transferChecked", info: {
    source: policy.source, destination, authority: policy.authority, mint: policy.mint, tokenAmount: {amount, decimals: 6},
  }}});
  return transaction;
}

test("only matching finalized distributor transfers add net credited rewards", () => {
  assert.equal(classify(tx(), account, owner, policy, feed()).amount, "100");
  const fee = classify(tx("1000", "1097"), account, owner, policy, feed());
  assert.equal(fee.kind, "reward"); assert.equal(fee.amount, "97");
});

test("explicit generating coin and asset scope are mandatory", () => {
  assert.equal(classify(tx(), account, owner, policy, feed([holderRow], otherOwner)).kind, "other");
  assert.equal(classify(tx(), account, owner, {...policy, rewardMint: undefined}, feed()).kind, "other");
  assert.equal(classify(tx(), account, owner, policy, feed([{...holderRow, assetMint: otherOwner}])).kind, "other");
  const stonk = tx(); stonk.meta!.postTokenBalances[0].mint = owner;
  assert.equal(classify(stonk, account, owner, policy, feed()).kind, "uncertain");
});

test("purchases, missing API batches, wrong sources and unsigned authorities never become rewards", () => {
  assert.equal(classify(tx(), account, owner, policy, feed([])).kind, "other");
  for (const field of ["source", "authority"]) {
    const purchase = tx(); purchase.transaction.message.instructions[0].parsed!.info[field] = owner;
    assert.notEqual(classify(purchase, account, owner, policy, feed()).kind, "reward");
  }
  const unsigned = tx(); unsigned.transaction.message.accountKeys[1].signer = false;
  assert.equal(classify(unsigned, account, owner, policy, feed()).kind, "uncertain");
  assert.equal(classify(tx(), account, owner, policy, feed([{...holderRow, amountRaw: "101"}])).kind, "other");
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
  assert.equal(classify(tx(), account, owner, narrow, feed([holderRow], owner)).kind, "other");
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

test("mixed coin payouts to DIFFERENT owners no longer require a whole-batch total match", () => {
  const mixed = addPayout(tx("1000", "1097"));
  const result = classify(mixed, account, owner, policy, feed());
  assert.equal(result.kind, "reward"); assert.equal(result.amount, "97");
  assert.deepEqual(result.payoutEvidence, {version: VERIFICATION_VERSION, mint: policy.rewardMint, wallet: owner, signature,
    assetMint: policy.mint, apiGross: "100", targetAccount: account, ownerGross: "100", creditedNet: "97", createdAt: holderRow.createdAt});
});

test("same wallet mixed coins, equal-sized transfers and alternate accounts cannot misattribute rewards", () => {
  for (const amount of ["50", "100"]) {
    const same = addPayout(tx("1000", (1100n + BigInt(amount)).toString()), account, owner, amount);
    assert.equal(classify(same, account, owner, policy, feed()).kind, "other");
    const alternate = addPayout(tx(), otherAccount, owner, amount);
    for (const expected of ["100", (100n + BigInt(amount)).toString()])
      assert.equal(classify(alternate, account, owner, policy, feed([{...holderRow, amountRaw: expected}])).kind, "other");
  }
  const combined = tx("1000", "1150");
  combined.transaction.message.instructions[0].parsed!.info.tokenAmount = {amount: "150", decimals: 6};
  assert.equal(classify(combined, account, owner, policy, feed()).kind, "other");
});

test("multiple same-target transfers may match exact holder gross, but only reconciled net is credited", () => {
  const multiple = addPayout(tx("1000", "1143"), account, owner);
  const rows = [{...holderRow, amountRaw: "150"}];
  assert.equal(classify(multiple, account, owner, policy, feed(rows)).amount, "143");
  assert.equal(classify(multiple, account, owner, policy, feed([...rows, rows[0]])).amount, "143");
  assert.equal(classify(tx("1000", "1000"), account, owner, policy, feed()).kind, "other");
  const fee = tx("1000", "1097"); fee.transaction.message.instructions[0].parsed!.type = "transferCheckedWithFee";
  assert.equal(classify(fee, account, owner, policy, feed()).amount, "97");
  const ordinary = addPayout(tx("1000", "1150"), account, owner);
  ordinary.transaction.message.instructions[1].parsed!.info.source = otherAccount;
  assert.equal(classify(ordinary, account, owner, policy, feed()).kind, "other");
});

test("wallet identity, signature, scope and legacy aggregate-only data cannot substitute for a holder row", () => {
  for (const row of [{...holderRow, holder: account}, {...holderRow, holder: otherOwner},
    {...holderRow, signature: "Z".repeat(64)}, {...holderRow, amountRaw: "0"}])
    assert.equal(classify(tx(), account, owner, policy, feed([row])).kind, "other");
  assert.equal(classify(tx(), account, owner, policy,
    distributions({data:{recentDistributions:[payout]}}) as unknown as WalletPayoutFeed).kind, "other");
  for (const amountRaw of ["-1", "01", "1.1", "18446744073709551616"])
    assert.throws(() => feed([{...holderRow, amountRaw}]));
  assert.throws(() => feed([holderRow, {...holderRow, amountRaw: "99"}]));
  assert.throws(() => feed([{...holderRow, holder: "bad"}]));
});

test("every distributor destination must have unambiguous stable owner and token identity", () => {
  const changes: ((t: ParsedTransaction) => void)[] = [
    t => { t.meta!.preTokenBalances.pop(); }, // newly created other account
    t => { t.meta!.postTokenBalances.pop(); }, // closed other account
    t => { t.meta!.postTokenBalances[1].owner = owner; },
    t => { delete t.meta!.postTokenBalances[1].owner; },
    t => { t.meta!.postTokenBalances[1].mint = otherOwner; },
    t => { t.meta!.postTokenBalances[1].programId = otherOwner; },
    t => { t.meta!.postTokenBalances[1].uiTokenAmount.decimals = 9; },
    t => { t.meta!.preTokenBalances.push(t.meta!.preTokenBalances[1]); },
    t => { t.transaction.message.accountKeys.push(t.transaction.message.accountKeys[2]); },
    t => { t.meta!.postTokenBalances[1].accountIndex = 99; },
  ];
  for (const change of changes) {
    const mixed = addPayout(tx()); change(mixed);
    assert.equal(classify(mixed, account, owner, policy, feed()).kind, "uncertain");
  }
});

test("owner-change-and-restore and close/reinitialize of OTHER destinations are never hidden by stable metadata", () => {
  for (const types of [["setAuthority", "setAuthority"], ["closeAccount", "initializeAccount3"]]) {
    const mixed = addPayout(tx());
    for (const type of types) mixed.transaction.message.instructions.push({programId: policy.tokenProgram,
      parsed:{type, info:{account: otherAccount, newAuthority: owner}}});
    assert.equal(classify(mixed, account, owner, policy, feed()).kind, "uncertain");
  }
  const delegated = addPayout(tx(), otherAccount, owner, "100");
  delegated.transaction.message.instructions[1].parsed!.info.authority = otherOwner;
  assert.equal(classify(delegated, account, owner, policy, feed()).kind, "uncertain");
});

test("checked transfers require mint and decimals; unchecked distributor transfers require proven source identity", () => {
  for (const field of ["mint", "tokenAmount"]) {
    const bad = tx(); delete bad.transaction.message.instructions[0].parsed!.info[field];
    assert.equal(classify(bad, account, owner, policy, feed()).kind, "uncertain");
  }
  const bad = tx(); bad.transaction.message.instructions[0].parsed!.info.tokenAmount = {amount:"100", decimals:9};
  assert.equal(classify(bad, account, owner, policy, feed()).kind, "uncertain");
  const unchecked = tx(); unchecked.transaction.message.instructions[0].parsed = {type:"transfer",info:{
    source:policy.source, destination:account, authority:policy.authority, amount:"100"}};
  assert.equal(classify(unchecked, account, owner, policy, feed()).kind, "uncertain");
  unchecked.transaction.message.accountKeys.push({pubkey:policy.source,signer:false});
  const balance = {accountIndex:2,owner:policy.authority,mint:policy.mint,programId:policy.tokenProgram,
    uiTokenAmount:{amount:"1000",decimals:6}};
  unchecked.meta!.preTokenBalances.push(balance);
  unchecked.meta!.postTokenBalances.push({...balance,uiTokenAmount:{amount:"900",decimals:6}});
  assert.equal(classify(unchecked, account, owner, policy, feed()).kind, "reward");
});

test("source authority changes cannot be hidden by a checked transfer", () => {
  const changed = tx();
  for (const newAuthority of [otherOwner, policy.authority]) changed.transaction.message.instructions.push({
    programId: policy.tokenProgram, parsed: {type:"setAuthority", info:{account:policy.source,newAuthority}},
  });
  assert.equal(classify(changed, account, owner, policy, feed()).kind, "uncertain");
});

test("saved public API rows match seven real finalized wallet receipts without a batch-total requirement", async () => {
  const fixture = (await import("./fixtures/stonk-holder-payout.json", {with:{type:"json"}})).default;
  const transaction = fixture.transaction as ParsedTransaction;
  const records = feed(fixture.rows);
  assert.equal(fixture.rows.length,7);
  assert.equal(transaction.meta!.err,null);
  for(const row of fixture.rows) {
    const post = transaction.meta!.postTokenBalances.find(b => b.owner === row.holder && b.mint === row.assetMint)!;
    const pre = transaction.meta!.preTokenBalances.find(b => b.accountIndex === post.accountIndex)!;
    const destination = transaction.transaction.message.accountKeys[post.accountIndex].pubkey;
    const expectedNet = BigInt(post.uiTokenAmount.amount)-BigInt(pre.uiTokenAmount.amount);
    assert.equal(expectedNet,BigInt(row.amountRaw)); // This observed sample has no withheld fee.
    const result = classify(transaction,destination,row.holder,policy,records);
    assert.equal(result.kind,"reward"); assert.equal(result.amount,expectedNet.toString());
    assert.equal(result.payoutEvidence!.apiGross,row.amountRaw);
  }
});


test("an absent exact holder row retries only an otherwise verified receipt for six chain-time hours", () => {
  const transaction = tx("1000", "1097"), received = transaction.blockTime!;
  for (const now of [received, received + PAYOUT_EVIDENCE_WAIT_SECONDS - 1]) {
    assert.throws(() => classify(transaction, account, owner, policy, feed([]), now),
      (error: unknown) => error instanceof MissingPayoutEvidence
        && error.retryUntil === received + PAYOUT_EVIDENCE_WAIT_SECONDS
        && error.observation.signature === signature && error.observation.after === "1097");
  }
  assert.equal(classify(transaction, account, owner, policy, feed([]), received + PAYOUT_EVIDENCE_WAIT_SECONDS).kind, "other");
  // The API timestamp is irrelevant to both the deadline and received net.
  assert.equal(classify(transaction, account, owner, policy,
    feed([{...holderRow, createdAt: "2099-01-01T00:00:00Z"}]), received + 10).amount, "97");
  for (const bad of [null, received + 1, 1.5]) {
    const missingTime = {...transaction, blockTime: bad};
    assert.equal(classify(missingTime, account, owner, policy, feed([]), received).kind, "other");
  }
});

test("conflicting rows, wrong scope and invalid distributor evidence never enter the missing-row retry", () => {
  const now = tx().blockTime! + 10;
  assert.equal(classify(tx(), account, owner, policy, feed([{...holderRow, amountRaw: "101"}]), now).kind, "other");
  assert.equal(classify(tx(), account, owner, policy, feed([], otherOwner), now).kind, "other");
  assert.equal(classify(tx("1000", "1000"), account, owner, policy, feed([]), now).kind, "other");
  const ordinary = tx(); ordinary.transaction.message.instructions[0].parsed!.info.source = owner;
  assert.equal(classify(ordinary, account, owner, policy, feed([]), now).kind, "other");
  const alternate = addPayout(tx(), otherAccount, owner);
  assert.equal(classify(alternate, account, owner, policy, feed([]), now).kind, "other");
});

test("a fresh completed archive ten minutes past a missing payout ends the wait without giving credit", () => {
  const transaction = tx(), received = transaction.blockTime!;
  const archived = (at: number, rows: WalletPayout[] = []): WalletPayoutFeed => ({
    ...feed(rows), completedArchive: {fetchedAt: new Date(at * 1000).toISOString()},
  });
  assert.throws(() => classify(transaction, account, owner, policy, archived(received + 599), received + 600), MissingPayoutEvidence);
  for (const now of [received + 600, received + 720]) {
    const result = classify(transaction, account, owner, policy, archived(received + 600), now);
    assert.equal(result.kind, "other"); assert.equal(result.amount, "0");
    assert.equal(result.payoutAttribution, "covered_absent");
    assert.equal(result.payoutEvidence, undefined);
  }
  const present = classify(transaction, account, owner, policy, archived(received + 600, [holderRow]), received + 600);
  assert.equal(present.kind, "reward"); assert.equal(present.amount, "100");
  const conflict = classify(transaction, account, owner, policy, archived(received + 600, [{...holderRow, amountRaw: "101"}]), received + 600);
  assert.equal(conflict.kind, "other"); assert.equal(conflict.payoutAttribution, undefined);
});

test("stale, future, malformed or synthetic archive metadata cannot shorten the durable wait", () => {
  const transaction = tx(), received = transaction.blockTime!, now = received + 1000;
  for (const completedArchive of [undefined, {fetchedAt: "not-a-date"}, {fetchedAt: ""},
    {fetchedAt: new Date((now - 121) * 1000).toISOString()},
    {fetchedAt: new Date((now + 1) * 1000).toISOString()},
  ]) {
    assert.throws(() => classify(transaction, account, owner, policy, {...feed([]), completedArchive}, now), MissingPayoutEvidence);
  }
  // Data or arbitrary scope fields cannot promote a synthetic/fallback feed.
  const fakeScope = {mint: policy.rewardMint!, quoteMint: policy.mint,
    completedArchive: {fetchedAt: new Date(now * 1000).toISOString()}};
  const fallback = walletPayouts([], fakeScope);
  assert.equal(fallback.completedArchive, undefined);
  assert.throws(() => classify(transaction, account, owner, policy, fallback, now), MissingPayoutEvidence);
  // Another holder's new row timestamp is not a completed archive capture time.
  const newRow = {...holderRow, holder: otherOwner, createdAt: new Date(now * 1000).toISOString()};
  assert.throws(() => classify(transaction, account, owner, policy, feed([newRow]), now), MissingPayoutEvidence);
});

test("expired persisted waits stay visible even after archive recovery; old first-seen exclusions are normal", () => {
  const transaction = tx(), received = transaction.blockTime!, now = received + PAYOUT_EVIDENCE_WAIT_SECONDS;
  const archived = {...feed([]), completedArchive: {fetchedAt: new Date(now * 1000).toISOString()}};
  assert.equal(classify(transaction, account, owner, policy, archived, now, now).payoutAttribution, "expired");
  assert.equal(classify(transaction, account, owner, policy, archived, now).payoutAttribution, "covered_absent");
  assert.equal(classify(transaction, account, owner, policy, feed([]), now).payoutAttribution, "expired");
  assert.equal(classify(transaction, account, owner, policy, {...archived, records: feed().records}, now, now).kind, "reward");
});
