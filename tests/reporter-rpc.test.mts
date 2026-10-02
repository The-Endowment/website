import assert from "node:assert/strict";
import { test } from "node:test";
import { history, latestCursor, type RpcCall } from "../lib/reporter/rpc.ts";

function fake(rows: unknown[], transactions: Record<string, unknown> = {}): RpcCall {
  return async <T,>(method: string, params: unknown[]): Promise<T> => {
    if (method === "getSignaturesForAddress") {
      assert.equal((params[1] as { commitment: string }).commitment, "finalized");
      return rows as T;
    }
    assert.equal(method, "getTransaction");
    assert.equal((params[1] as { commitment: string }).commitment, "finalized");
    return (transactions[String(params[0])] ?? null) as T;
  };
}
const row = (signature: string, slot: number) => ({ signature, slot, err: null, confirmationStatus: "finalized" });
const tx = (signature: string, slot: number) => ({ slot, transaction: { signatures: [signature] } });

test("forward history requires the saved cursor and replays oldest to newest", async () => {
  const rpc = fake([row("second", 12), row("first", 11), row("start", 10)], { first: tx("first", 11), second: tx("second", 12) });
  const result = await history(rpc, "source", "start", 10, 12);
  assert.deepEqual(result.transactions.map((x) => x.transaction.signatures[0]), ["first", "second"]);
  assert.equal(result.cursor, "second");
});

test("pruned cursors, missing transactions and inconsistent signatures are gaps", async () => {
  await assert.rejects(history(fake([row("first", 11)]), "source", "start", 10, 12), /gap/);
  await assert.rejects(history(fake([row("first", 11), row("start", 10)]), "source", "start", 10, 12), /Missing/);
  await assert.rejects(history(fake([row("first", 11), row("start", 10)], { first: tx("wrong", 11) }), "source", "start", 10, 12), /inconsistent/);
});

test("history and cursor reads newer than snapshot require retry", async () => {
  await assert.rejects(history(fake([row("new", 13)]), "source", "start", 10, 12), /advanced/);
  await assert.rejects(latestCursor(fake([row("new", 13)]), "source", 12), /advanced/);
});

test("initial empty history has no historical reward debt", async () => {
  assert.equal(await latestCursor(fake([]), "source", 12), null);
  assert.deepEqual(await history(fake([]), "source", null, 10, 12), { transactions: [], cursor: null });
});
