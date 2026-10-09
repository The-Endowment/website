import assert from "node:assert/strict";
import { test } from "node:test";
import { PROGRAM_ERRORS } from "../lib/endowment.ts";

// The rehearsal on 2026-10-08 caught a hand-kept list two codes off: a normal
// price-band skip (6029) was logged as "TransferHookEnabled".
test("keeper error names come from the compiled program", () => {
  assert.equal(PROGRAM_ERRORS[6008], "NothingToBuy");
  assert.equal(PROGRAM_ERRORS[6027], "TransferHookEnabled");
  assert.equal(PROGRAM_ERRORS[6029], "PriceAboveTwap");
  assert.equal(PROGRAM_ERRORS[6045], "PriceBelowTwap");
  assert.equal(PROGRAM_ERRORS[6047], "NotAttested");
  assert.equal(PROGRAM_ERRORS[6067], "CollectionInvalidated");
});
