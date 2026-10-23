import assert from "node:assert/strict";
import { test } from "node:test";
import { enrollmentUsesTracked } from "../lib/holding/consent-mode.ts";

test("Stop and rejoin preserve the existing protection mode regardless of the new-enrollment flag", () => {
  for (const flag of [false, true]) {
    assert.equal(enrollmentUsesTracked({ reserved: [0] }, flag), false);
    assert.equal(enrollmentUsesTracked({ reserved: [1] }, flag), true);
  }
});

test("only an enrollment with no existing record takes the displayed launch default", () => {
  assert.equal(enrollmentUsesTracked(null, false), false);
  assert.equal(enrollmentUsesTracked(null, true), true);
});
