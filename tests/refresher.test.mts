import assert from "node:assert/strict";
import { test } from "node:test";
import { assertRefresherRoles, refresherPass } from "../lib/refresher.ts";
import { sendAll, type Keeper } from "../lib/keeper-runtime.ts";

test("separate reviewer/refresher custody rejects collector or shared-role signers", () => {
  const roles = { refresher: "roy-refresh", collector: "brett", reviewer: "roy-review" };
  assert.doesNotThrow(() => assertRefresherRoles("roy-refresh", roles));
  assert.throws(() => assertRefresherRoles("brett", roles));
  assert.throws(() => assertRefresherRoles("roy-refresh", { ...roles, collector: "roy-refresh" }));
  assert.throws(() => assertRefresherRoles("roy-refresh", { ...roles, reviewer: "roy-refresh" }));
  assert.throws(() => assertRefresherRoles("roy-refresh", { ...roles, collector: "11111111111111111111111111111111" }));
});

test("rotation/custody failure prevents all jobs and is never reported healthy", async () => {
  let jobs = 0;
  const unexpected = async () => { jobs++; return {}; };
  const result = await refresherPass({ verify: async () => { throw new Error("wrong role"); },
    refresh: unexpected, count: unexpected, post: unexpected });
  assert.equal(jobs, 0);
  assert.equal(result.ok, false);
});

test("each job revalidates custody; a partial failed pass still attempts the reward baseline", async () => {
  const calls: string[] = [];
  const result = await refresherPass({ verify: async () => { calls.push("verify"); },
    refresh: async () => { calls.push("refresh"); return { failures: ["unconfirmed"] }; },
    count: async () => { calls.push("count"); throw new Error("https://provider/SECRET"); },
    post: async () => { calls.push("post"); return { posted: "100" }; } });
  assert.deepEqual(calls, ["verify", "refresh", "verify", "count", "verify", "post"]);
  assert.equal(result.ok, false);
  assert.equal(result.outcomes[2].ok, true);
  assert.ok(!JSON.stringify(result).includes("SECRET"));
});

test("nested refresh failures and non-attesting passes fail; healthy scheduled skips pass", async () => {
  const base = { verify: async () => {}, refresh: async () => ({ skipped: "not this tick" }),
    count: async () => ({ skipped: "counted recently" }), post: async () => ({ skipped: "posted recently" }) };
  assert.equal((await refresherPass(base)).ok, true);
  assert.equal((await refresherPass({ ...base, count: async () => ({ refresh: { failures: ["failed"] } }) })).ok, false);
  assert.equal((await refresherPass({ ...base, refresh: async () => ({ attests: false }) })).ok, false);
});

test("deadline before dispatch reports each unattempted batch as failed, with no RPC or signing", async () => {
  const result = await sendAll({} as Keeper, [
    { item: "wallet-a", ixs: [], computeUnits: 1 }, { item: "wallet-b", ixs: [], computeUnits: 1 },
  ], Date.now() - 1);
  assert.deepEqual(result.map(({ item, error }) => ({ item, error })), [
    { item: "wallet-a", error: "batch_deadline_exceeded" },
    { item: "wallet-b", error: "batch_deadline_exceeded" },
  ]);
});
