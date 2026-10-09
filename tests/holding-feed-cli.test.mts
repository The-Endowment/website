import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { archiveFeed } from "../lib/holding/feed.ts";

type Role = "collector" | "reviewer";

function run(script: "capture-payout-feed" | "held-rewards", role: Role, directory: string, stub: string) {
  return spawnSync(process.execPath, ["--experimental-strip-types", "--import",
    `data:text/javascript,${encodeURIComponent(stub)}`,
    fileURLToPath(new URL(`../scripts/${script}.mts`, import.meta.url)), `--role=${role}`], {
    encoding: "utf8", timeout: 15000,
    env: { ...process.env, HOLD_DATA_DIR: directory, HOLD_STOP_FILE: join(directory, "collection.stop"),
      HOLD_ALERT_WEBHOOK: "", HOLD_HEARTBEAT_MODE: "observe", HOLD_KEYPAIR_FILE: "/must-not-read-a-signer",
      SOLANA_RPC_URL: "https://rpc.example/", NEXT_PUBLIC_ENDOWMENT_PROGRAM_ID: "HhJJRPcwABobT6jCEusieGuZxv6XvSKKvU32XyXASVF6",
      NEXT_PUBLIC_ENDOWMENT_CREATOR: "b5b42jEAoEj3WJnf2R29aPuKkkeUWmRLFsg1b8R3Fta",
      HOLD_COLLECTOR_HEARTBEAT_URL: "https://monitor.example/collector",
      HOLD_REVIEWER_HEARTBEAT_URL: "https://monitor.example/reviewer",
      HOLD_COLLECTOR_FEED_HEARTBEAT_URL: "https://monitor.example/collector-feed",
      HOLD_REVIEWER_FEED_HEARTBEAT_URL: "https://monitor.example/reviewer-feed" },
  });
}

function captureStub(role: Role, success = true, allowFeed = true) {
  return `globalThis.fetch = async (url, options) => {
    if (String(url) === 'https://www.stonkfun.xyz/api/public/v1/rewards?limit=100') {
      if (!${allowFeed}) throw new Error('fetch before role validation');
      console.log('stubbed_feed_request');
      if (!${success}) throw new Error('provider-private-secret');
      return Response.json({data:{recentDistributions:[]},meta:{generatedAt:new Date().toISOString()}});
    }
    if (String(url) !== 'https://monitor.example/${role}-feed${success ? "" : "/fail"}')
      throw new Error('unexpected network work');
    if (JSON.stringify(JSON.parse(options.body)) !== JSON.stringify({role:'${role}-feed',result:'${success ? "completed" : "failed"}'}))
      throw new Error('wrong monitor payload');
    console.log('stubbed_feed_${success ? "completed" : "failed"}');
    return new Response('',{status:200});
  };`;
}

function workerStub(role: Role) {
  return `globalThis.fetch = async (url, options) => {
    if (String(url) === 'https://rpc.example/' && JSON.parse(options.body).method === 'getProgramAccounts') {
      console.log('stubbed_recovery_rpc');
      return Response.json({result:[]});
    }
    if (String(url) !== 'https://monitor.example/${role}/fail') throw new Error('unexpected network work');
    if (JSON.stringify(JSON.parse(options.body)) !== JSON.stringify({role:'${role}',result:'failed'}))
      throw new Error('wrong monitor payload');
    console.log('stubbed_worker_failed');
    return new Response('',{status:200});
  };`;
}

test("capture runs independently of a wallet pass and never clears its collection stop", async () => {
  for (const role of ["collector", "reviewer"] as const) {
    const directory = await mkdtemp(join(tmpdir(), "feed-cli-lock-"));
    try {
      await mkdir(join(directory, "worker.lock"));
      await writeFile(join(directory, "collection.stop"), "operator clearance required\n");
      const child = run("capture-payout-feed", role, directory, captureStub(role));
      assert.equal(child.error, undefined);
      assert.equal(child.status, 0, child.stderr + child.stdout);
      assert.match(child.stdout, /stubbed_feed_request/);
      assert.match(child.stdout, /stubbed_feed_completed/);
      assert.equal(await readFile(join(directory, "role"), "utf8"), role);
      assert.equal(await readFile(join(directory, "collection.stop"), "utf8"), "operator clearance required\n");
      assert.doesNotMatch(child.stdout + child.stderr, /monitor\.example|rpc\.example|private-secret/);
      await rm(join(directory, "worker.lock"), { recursive: true }); // Capture did not remove the wallet lock.
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test("capture rejects a directory bound to the other role before any feed request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "feed-cli-role-"));
  try {
    await writeFile(join(directory, "role"), "collector");
    const child = run("capture-payout-feed", "reviewer", directory, captureStub("reviewer", false, false));
    assert.equal(child.error, undefined);
    assert.equal(child.status, 1, child.stderr + child.stdout);
    assert.match(child.stdout, /stubbed_feed_failed/);
    assert.doesNotMatch(child.stdout, /stubbed_feed_request/);
    assert.equal(await readFile(join(directory, "role"), "utf8"), "collector");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("capture failure sends only the separate feed-failure heartbeat with redacted diagnostics", async () => {
  for (const role of ["collector", "reviewer"] as const) {
    const directory = await mkdtemp(join(tmpdir(), "feed-cli-failure-"));
    try {
      const child = run("capture-payout-feed", role, directory, captureStub(role, false));
      assert.equal(child.error, undefined);
      assert.equal(child.status, 1, child.stderr + child.stdout);
      assert.match(child.stdout, /stubbed_feed_failed/);
      assert.match(child.stdout, /"heartbeat":"delivered"/);
      assert.doesNotMatch(child.stdout + child.stderr, /private-secret|monitor\.example|rpc\.example|stubbed_feed_completed/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test("a healthy capture cannot satisfy a quarantined collector's independent worker check", async () => {
  const directory = await mkdtemp(join(tmpdir(), "feed-cli-separate-health-"));
  try {
    await writeFile(join(directory, "collection.stop"), "prior incident\n");
    const capture = run("capture-payout-feed", "collector", directory, captureStub("collector"));
    assert.equal(capture.status, 0, capture.stderr + capture.stdout);
    assert.match(capture.stdout, /stubbed_feed_completed/);
    const worker = run("held-rewards", "collector", directory, workerStub("collector"));
    assert.equal(worker.error, undefined);
    assert.equal(worker.status, 1, worker.stderr + worker.stdout);
    assert.match(worker.stdout, /stubbed_worker_failed/);
    assert.match(worker.stdout, /collection_quarantined/);
    assert.equal(await readFile(join(directory, "collection.stop"), "utf8"), "prior incident\n");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

for (const state of ["missing", "stale"] as const) {
  test(`${state} archive stops the collector but still attempts the reviewer's recovery scan`, async () => {
    for (const role of ["collector", "reviewer"] as const) {
      const directory = await mkdtemp(join(tmpdir(), "feed-cli-unavailable-"));
      try {
        if (state === "stale") {
          const now = Date.now() - 180000;
          await archiveFeed(directory, { now: () => now, request: (async () => Response.json({
            data: { recentDistributions: [] }, meta: { generatedAt: new Date(now).toISOString() },
          })) as typeof fetch });
        }
        const child = run("held-rewards", role, directory, workerStub(role));
        assert.equal(child.error, undefined);
        assert.equal(child.status, 1, child.stderr + child.stdout);
        assert.match(child.stdout, /stubbed_worker_failed/);
        assert.match(child.stdout, /feed_unavailable/);
        if (role === "reviewer") {
          assert.match(child.stdout, /stubbed_recovery_rpc/);
          await assert.rejects(readFile(join(directory, "collection.stop")), { code: "ENOENT" });
        } else {
          assert.doesNotMatch(child.stdout, /stubbed_recovery_rpc/);
          assert.match(await readFile(join(directory, "collection.stop"), "utf8"), /feed_unavailable/);
        }
      } finally { await rm(directory, { recursive: true, force: true }); }
    }
  });
}
