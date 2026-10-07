import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePrices, usdEstimate, usdFromDollars } from "../lib/values.ts";

const PENIS = "JE3HT7SbCgXDQWV6xp3oiiAisDzq4HyZ8wyEVBDCs45Z";
const PUMP = "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn";

test("prices come from Jupiter's response by mint, and junk is dropped", () => {
  assert.deepEqual(parsePrices({ [PENIS]: { usdPrice: 0.00026 }, [PUMP]: { usdPrice: 0.0064 } }),
    { penisUsd: 0.00026, pumpUsd: 0.0064 });
  assert.deepEqual(parsePrices({ [PENIS]: { usdPrice: "1" }, [PUMP]: { usdPrice: -1 } }), { penisUsd: null, pumpUsd: null });
  assert.deepEqual(parsePrices(null), { penisUsd: null, pumpUsd: null });
});

test("dollar estimates round to three figures and hide without a price", () => {
  // 121,206,755.376701 PUMP at $0.0064271 = $779,013 -> $779,000
  assert.equal(usdEstimate("121206755376701", 0.0064271), "$779,000");
  assert.equal(usdEstimate("1000000", 2.4), "$2");
  assert.equal(usdEstimate("1000000", null), null);
  assert.equal(usdEstimate("0", 1), null);
  assert.equal(usdFromDollars(779_013.4), "$779,000");
  assert.equal(usdFromDollars(Number.NaN), null);
});
