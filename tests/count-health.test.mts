import assert from "node:assert/strict";
import { mock, test } from "node:test";
import fixture from "./fixtures/holding-chain.json" with { type: "json" };
import { base64ToBytes, COUNT_INTERVAL_SECS } from "../lib/endowment.ts";
import { concat, decodeAccount, encode, schema } from "../lib/holding/codec.ts";
import type { Config } from "../lib/holding/types.ts";
import { countHealth, type Keeper } from "../lib/keeper-runtime.ts";
import { REWARD_POST_STALE_SECS } from "../lib/reward-total.ts";

test("chain freshness alarms work when the web keeper is separate from the refresher", async () => {
  const now = 2_000_000_000;
  const clock = mock.method(Date, "now", () => now * 1000);
  const records: Record<string, { data: string[] }> = fixture.records;
  const config = decodeAccount<Config>("Config", base64ToBytes(records[fixture.config].data[0]));
  config.landlord_count = 1;
  config.count.open = false;
  config.paused_until = 0n;
  config.params.allowance_margin_bps = 10_000;
  assert.notEqual(config.params.refresher, fixture.owner);
  let reads = 0;
  const keeper = {
    signer: { address: fixture.owner }, inst: { config: fixture.config },
    rpc: { getAccountInfo: (account: string) => ({ send: async () => {
      assert.equal(account, fixture.config);
      reads++;
      const bytes = concat(Uint8Array.from(schema.accounts.Config), encode({ defined: { name: "Config" } }, config));
      return { value: { data: [Buffer.from(bytes).toString("base64"), "base64"] } };
    } }) },
  } as unknown as Keeper;
  const fresh = () => {
    config.last_count_at = BigInt(now);
    config.last_attested_at = BigInt(now);
    config.last_reward_post_at = BigInt(now);
  };
  try {
    fresh();
    const healthy = await countHealth(keeper);
    assert.equal(healthy.refresherIsKeeper, false);
    assert.equal(healthy.stale, false);
    for (const [field, alarm, threshold] of [
      ["last_count_at", "countStale", 2 * COUNT_INTERVAL_SECS],
      ["last_attested_at", "attestStale", 12 * 60 * 60],
      ["last_reward_post_at", "rewardPostStale", REWARD_POST_STALE_SECS],
    ] as const) {
      for (const timestamp of [0n, BigInt(now - threshold - 1), BigInt(now + 1)]) {
        fresh();
        config[field] = timestamp;
        const health = await countHealth(keeper);
        assert.equal(health.refresherIsKeeper, false);
        assert.equal(health[alarm], true, `${field}=${timestamp}`);
        assert.equal(health.stale, true);
      }
    }
    assert.equal(reads, 10);
  } finally { clock.mock.restore(); }
});
