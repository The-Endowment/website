import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withJournal } from "../lib/reporter/journal.ts";
import type { RpcCall } from "../lib/reporter/rpc.ts";
import { settleOutbox } from "../lib/holding/outbox.ts";
const key = "HpsRzXK3xWQxD1Px1KoExP5KYWs5gByEu47z6Ne6gDNf";
const prepared = {
  wire: "wire",
  signature: "signature",
  nonce: "0",
  amount: "40",
  expiresAt: 100,
  lastValidBlockHeight: "123",
  evidenceHash: "1".repeat(64),
};
test("ambiguous broadcast retains exact outbox across restart and does not sign again", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hold-outbox-"));
  let signed = 0,
    published = 0;
  const prepare = async () => {
    signed++;
    return prepared;
  };
  const rpc = (async (method: string) => {
    if (method === "sendTransaction") {
      published++;
      throw new Error("response lost");
    }
    if (method === "getSignatureStatuses") return { value: [null] };
    if (method === "getBlockHeight") return 120;
    throw new Error(method);
  }) as RpcCall;
  try {
    await assert.rejects(
      () => withJournal(dir, key, (j) => settleOutbox(j, rpc, key, prepare)),
      /response lost/,
    );
    await withJournal(dir, key, async (j) => {
      assert.equal(j.state!.pending!.wire, "wire");
      assert.equal(await settleOutbox(j, rpc, key, prepare), "pending");
    });
    assert.equal(signed, 1);
    assert.equal(published, 1);
    const done = (async () => ({
      value: [{ confirmationStatus: "finalized", err: null }],
    })) as RpcCall;
    await withJournal(dir, key, async (j) => {
      assert.equal(await settleOutbox(j, done, key, prepare), "reconciled");
      assert.equal(j.state!.pending, null);
    });
    assert.equal(signed, 1);
  } finally {
    await rm(dir, { recursive: true });
  }
});
