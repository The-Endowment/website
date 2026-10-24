import assert from "node:assert/strict";
import { test } from "node:test";
import { history, jsonRpc } from "../lib/reporter/rpc.ts";

const ok = (result: unknown) => Response.json({ jsonrpc: "2.0", id: 1, result });
function network(replies: (() => Response)[]) {
  const calls: { method: string; params: unknown[] }[] = [], waits: number[] = [];
  const rpc = jsonRpc("https://rpc.example.test", {
    fetch: async (_url, options) => {
      calls.push(JSON.parse(String(options?.body)));
      const reply = replies.shift(); assert.ok(reply, "Unexpected additional RPC attempt"); return reply();
    },
    sleep: async ms => { waits.push(ms); },
  });
  return { rpc, calls, waits };
}

test("temporary HTTP and RPC read failures recover with bounded backoff and identical finalized parameters", async () => {
  const n = network([() => new Response(null, {status: 429}),
    () => Response.json({error: {code: -32016}}), () => ok([{signature: "start", slot: 10}])]);
  const params = ["source", {commitment: "finalized", minContextSlot: 20, before: "saved-page", limit: 1000}];
  assert.deepEqual(await n.rpc("getSignaturesForAddress", params), [{signature: "start", slot: 10}]);
  assert.deepEqual(n.calls, Array(3).fill({method: "getSignaturesForAddress", params}).map(x => ({jsonrpc: "2.0", id: 1, ...x})));
  assert.deepEqual(n.waits, [250, 750]);
});

test("temporary read failures stop after three attempts", async () => {
  const n = network(Array.from({length: 3}, () => () => new Response(null, {status: 503})));
  await assert.rejects(n.rpc("getTransaction", ["signature"]), /HTTP 503/);
  assert.equal(n.calls.length, 3); assert.deepEqual(n.waits, [250, 750]);
});

test("connection reset and timeout are retried, while invalid parameters, credentials and malformed data are not", async () => {
  for (const first of [
    () => { throw new TypeError("fetch failed", {cause: {code: "ECONNRESET"}}); },
    () => { throw new DOMException("read timeout", "TimeoutError"); },
  ]) {
    const n = network([first, () => ok(123)]);
    assert.equal(await n.rpc("getBlockHeight", []), 123); assert.equal(n.calls.length, 2);
  }
  for (const first of [
    () => new Response(null, {status: 401}), () => new Response(null, {status: 403}),
    () => Response.json({error: {code: -32602}}), () => Response.json({error: {code: -32015}}),
    () => Response.json({error: {code: -32009}}), () => Response.json({}),
    () => new Response("not JSON"),
    () => { throw new TypeError("fetch failed", {cause: {code: "CERT_HAS_EXPIRED"}}); },
  ]) {
    const n = network([first]);
    await assert.rejects(n.rpc("getTransaction", ["signature"]));
    assert.equal(n.calls.length, 1); assert.deepEqual(n.waits, []);
  }
});

test("submission and unknown methods are never automatically retried", async () => {
  for (const method of ["sendTransaction", "requestAirdrop", "getUnreviewedMethod"])
    for (const first of [() => new Response(null, {status: 503}),
      () => { throw new TypeError("fetch failed", {cause: {code: "ECONNRESET"}}); }]) {
      const n = network([first]);
      await assert.rejects(n.rpc(method, ["wire"]));
      assert.equal(n.calls.length, 1); assert.deepEqual(n.waits, []);
    }
});

test("successful but missing or inconsistent history remains a gap, not a transport retry", async () => {
  const row = (signature: string, slot: number) => ({signature, slot, err: null, confirmationStatus: "finalized"});
  for (const transaction of [null, {slot: 11, transaction: {signatures: ["wrong"]}}]) {
    const n = network([() => ok([row("reward", 11), row("start", 10)]), () => ok(transaction)]);
    await assert.rejects(history(n.rpc, "source", "start", 10, 12), /Missing or inconsistent/);
    assert.equal(n.calls.length, 2); assert.deepEqual(n.waits, []);
  }
  const pruned = network([() => ok([row("reward", 11)])]);
  await assert.rejects(history(pruned.rpc, "source", "start", 10, 12), /history gap/);
  assert.equal(pruned.calls.length, 1);
});
