import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { holdingBank } from "./support/holding-bank.mts";
import { walletTick, type WorkerOptions } from "../lib/holding/worker.ts";
import { withJournal } from "../lib/reporter/journal.ts";
import { jsonRpc } from "../lib/reporter/rpc.ts";
import { PassHealth } from "../lib/holding/operations-health.ts";

test("temporary HTTP failures recover through the worker read path; exhausted attempts stop both roles", async t => {
  for (const failures of [1, 3]) {
    const bank = await holdingBank(), directory = await mkdtemp(join(tmpdir(), "hold-rpc-retry-"));
    t.after(() => rm(directory, {recursive: true, force: true}));
    t.mock.method(Date, "now", () => bank.time() * 1000);
    const options = (role: "collector" | "reviewer"): WorkerOptions => ({
      rpc: bank.rpc, rpcUrl: "http://127.0.0.1:1", inst: bank.inst, directory: join(directory, role),
      role, submit: false, source: bank.source, feed: bank.feed,
    });
    for (const role of ["collector", "reviewer"] as const) await walletTick(options(role), bank.owner, []);
    bank.move("reward", 10n);
    for (const role of ["collector", "reviewer"] as const) {
      let left = failures, attempts = 0;
      const health = new PassHealth(role, false);
      const rpc = jsonRpc("https://rpc.example.test", {
        fetch: async (_url, options) => {
          const {method, params} = JSON.parse(String(options?.body));
          if (method === "getSignaturesForAddress") {
            attempts++;
            if (left-- > 0) return new Response(null, {status: 503});
          }
          return Response.json({result: await bank.rpc(method, params)});
        }, sleep: async () => {},
      });
      try { health.outcome(await walletTick({...options(role), rpc,
        observe: event => health.observe(bank.owner, event)}, bank.owner, [])); }
      catch { health.failure(); }
      const state = await withJournal(join(directory, role, "wallets"), bank.a.dividend_account,
        async journal => journal.state!);
      if (failures === 1) {
        assert.ok(attempts >= 2); assert.equal(health.historyStop(), false); assert.equal(health.failures, 0);
        assert.equal(state.eligible, "10");
      } else {
        assert.ok(health.historyStop() || health.failures > 0); assert.equal(state.eligible, "0");
      }
    }
    assert.equal(bank.wires.length, 0); t.mock.restoreAll();
  }
});
