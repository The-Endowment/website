import assert from "node:assert/strict";
import { test } from "node:test";
import { address, generateKeyPairSigner } from "@solana/kit";
import { checkLaunchParams, parseParams } from "../lib/launch-params.ts";
import { instruction, schema } from "../lib/holding/codec.ts";

const raw = {
  max_buy_per_tx: "500000000000", max_buy_per_day: "5000000000000", min_buy_amount: "1000000000",
  min_buy_interval_secs: "900", max_rewards_per_day: "20000000000000",
  max_price_impact_bps: 100, max_twap_deviation_bps: 300, tip_bps: 25, buy_bps: 10_000,
  activate_bps: 0, deactivate_bps: 0, min_stake_bps: 10, allowance_margin_bps: 10_000,
  refresher: "J33NbFxpRvGZyR9JsVA2u1KBw2FDAjB2bFzhAu8AErAS",
};
const check = (over: Record<string, unknown>, creating = true) =>
  () => checkLaunchParams(parseParams({ ...raw, ...over }), { creating });

test("a founders-mode file parses and passes", () => {
  assert.doesNotThrow(check({}));
  assert.equal(parseParams(raw).max_buy_per_day, 5_000_000_000_000n);
});

test("create_endowment encodes to the contract's Borsh layout", async () => {
  const creator = await generateKeyPairSigner();
  const any = address("11111111111111111111111111111111");
  const accounts = Object.fromEntries(schema.instructions.create_endowment.accounts.map((a) => [a.name, any]));
  const ix = instruction(address(schema.address), "create_endowment", { ...accounts, creator },
    { params: { admin: any, guardian: any, params: parseParams(raw), contribution_cap: 200_000_000_000_000n } });
  // 8 discriminator + 32 admin + 32 guardian + 88 Params + 8 cap.
  assert.equal(ix.data!.length, 168);
  assert.equal(ix.accounts!.length, 12);
});

test("files with wrong types or extra fields are refused", () => {
  assert.throws(() => parseParams({ ...raw, max_buy_per_tx: 5 }), /decimal string/);
  assert.throws(() => parseParams({ ...raw, activate: 0 }), /Unknown fields/);
});

test("the contract's v4 rules are enforced before signing", () => {
  assert.throws(check({ activate_bps: 2000, deactivate_bps: 1500 }), /0\/0/);
  assert.throws(check({ activate_bps: 3000, deactivate_bps: 2500 }), /founders mode/);
  assert.doesNotThrow(check({ activate_bps: 3000, deactivate_bps: 2500 }, false));
  assert.throws(check({ allowance_margin_bps: 15_000 }), /1\.0x/);
  assert.throws(check({ max_rewards_per_day: "50000000000001" }), /10x/);
  assert.throws(check({ tip_bps: 51 }), /tip_bps/);
  assert.throws(check({ min_buy_interval_secs: "30" }), /min_buy_interval_secs/);
  assert.throws(check({ refresher: "11111111111111111111111111111111" }), /refresher/);
});
