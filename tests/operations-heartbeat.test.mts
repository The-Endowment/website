import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mock, test } from "node:test";
import { deliverHeartbeat, type MonitoredRole } from "../lib/operations-heartbeat.ts";

test("heartbeats are optional and each configured role sends only a fixed completed-pass payload", async () => {
  let calls = 0;
  const request = (async (url: URL, options: RequestInit) => {
    calls++;
    assert.equal(url.toString(), "https://monitor.example/check?token=private");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    const body = JSON.parse(String(options.body));
    assert.equal(body.result, "completed");
    assert.ok(["collector", "reviewer", "refresher"].includes(body.role));
    assert.deepEqual(Object.keys(body).sort(), ["result", "role"]);
    assert.equal(String(options.body).includes("private"), false);
    return new Response("", { status: 200 });
  }) as typeof fetch;
  assert.equal(await deliverHeartbeat({ role: "collector", success: true }, request), "disabled");
  assert.equal(calls, 0);
  for (const role of ["collector", "reviewer", "refresher"] as MonitoredRole[]) {
    assert.equal(await deliverHeartbeat({ endpoint: "https://monitor.example/check?token=private", role,
      success: true }, request), "delivered");
  }
  assert.equal(calls, 3);
});

test("a failed pass uses the failure endpoint without dropping its authentication query", async () => {
  const request = (async (url: URL, options: RequestInit) => {
    assert.equal(url.toString(), "https://monitor.example/check/fail?token=private");
    assert.deepEqual(JSON.parse(String(options.body)), { role: "reviewer", result: "failed" });
    return new Response("", { status: 200 });
  }) as typeof fetch;
  for (const endpoint of ["https://monitor.example/check?token=private", "https://monitor.example/check/?token=private"]) {
    assert.equal(await deliverHeartbeat({ endpoint, role: "reviewer", success: false }, request), "delivered");
  }
});

test("invalid endpoints and failed deliveries are redacted results, not thrown errors or retries", async () => {
  let calls = 0;
  const request = (async () => { calls++; throw new Error("https://monitor.example/private-secret"); }) as typeof fetch;
  for (const endpoint of ["not a URL private-secret", "http://monitor.example/check", "https://user:private-secret@monitor.example/check", "https://monitor.example/check#private-secret"]) {
    assert.equal(await deliverHeartbeat({ endpoint, role: "collector", success: true }, request), "failed");
  }
  assert.equal(calls, 0);
  assert.equal(await deliverHeartbeat({ endpoint: "https://monitor.example/check", role: "collector", success: true }, request), "failed");
  assert.equal(calls, 1);
  assert.equal(await deliverHeartbeat({ endpoint: "https://monitor.example/check", role: "collector", success: false },
    (async () => new Response("private-secret", { status: 503 })) as typeof fetch), "failed");
});

test("delivery has a bounded timeout and a timeout cannot report a healthy heartbeat", async () => {
  const timeout = mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    assert.equal(milliseconds, 5000);
    return AbortSignal.abort();
  });
  try {
    const request = (async (_url: unknown, options: RequestInit) => {
      options.signal!.throwIfAborted();
      assert.fail("Request must see the configured timeout");
    }) as typeof fetch;
    assert.equal(await deliverHeartbeat({ endpoint: "https://monitor.example/check", role: "refresher", success: true }, request), "failed");
    assert.equal(timeout.mock.callCount(), 1);
  } finally { timeout.mock.restore(); }
});

test("worker startup failure sends only its role's failure heartbeat and exits nonzero", () => {
  for (const role of ["collector", "reviewer"]) {
    // All child fetches are replaced before imports; no monitor or RPC is called.
    const stub = `globalThis.fetch = async (url, options) => {
      if (String(url) !== 'https://monitor.example/${role}/fail') throw new Error('wrong endpoint');
      if (JSON.stringify(JSON.parse(options.body)) !== JSON.stringify({role:'${role}',result:'failed'})) throw new Error('wrong payload');
      console.log('stubbed_failure_ping_${role}');
      return new Response('', {status:200});
    };`;
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--import",
      `data:text/javascript,${encodeURIComponent(stub)}`,
      fileURLToPath(new URL("../scripts/held-rewards.mts", import.meta.url)), `--role=${role}`], {
      encoding: "utf8", timeout: 15000,
      env: { ...process.env, SOLANA_RPC_URL: "", HOLD_DATA_DIR: "", HOLD_HEARTBEAT_MODE: "observe",
        HOLD_COLLECTOR_HEARTBEAT_URL: "https://monitor.example/collector",
        HOLD_REVIEWER_HEARTBEAT_URL: "https://monitor.example/reviewer" },
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 1, child.stderr);
    assert.match(child.stdout, new RegExp(`stubbed_failure_ping_${role}`));
    assert.match(child.stdout, /"heartbeat":"delivered"/);
    assert.doesNotMatch(child.stdout + child.stderr, /monitor\.example/);
  }
});

test("missing or mismatched heartbeat mode cannot report worker success or start network work", () => {
  for (const role of ["collector", "reviewer"]) {
    for (const [expectedMode, submit] of [["", false], ["submit", false], ["observe", true]] as const) {
      const stub = `globalThis.fetch = async (url, options) => {
        if (String(url) !== 'https://monitor.example/${role}/fail') throw new Error('unexpected network work');
        if (JSON.stringify(JSON.parse(options.body)) !== JSON.stringify({role:'${role}',result:'failed'})) throw new Error('wrong payload');
        console.log('stubbed_mode_failure_${role}');
        return new Response('', {status:200});
      };`;
      const child = spawnSync(process.execPath, ["--experimental-strip-types", "--import",
        `data:text/javascript,${encodeURIComponent(stub)}`,
        fileURLToPath(new URL("../scripts/held-rewards.mts", import.meta.url)), `--role=${role}`,
        ...(submit ? ["--submit"] : [])], {
        encoding: "utf8", timeout: 15000,
        env: { ...process.env, HOLD_HEARTBEAT_MODE: expectedMode,
          HOLD_COLLECTOR_HEARTBEAT_URL: "https://monitor.example/collector",
          HOLD_REVIEWER_HEARTBEAT_URL: "https://monitor.example/reviewer" },
      });
      assert.equal(child.error, undefined);
      assert.equal(child.status, 1, child.stderr);
      assert.match(child.stdout, new RegExp(`stubbed_mode_failure_${role}`));
      assert.match(child.stdout, /"heartbeat":"delivered"/);
      assert.doesNotMatch(child.stdout + child.stderr, /monitor\.example|completed/);
    }
  }
});

test("a complete observation worker pass pings success only when the monitor expects observe", () => {
  for (const role of ["collector", "reviewer"]) {
    for (const expectedMode of ["observe", "submit", ""]) {
      const directory = mkdtempSync(join(tmpdir(), "heartbeat-mode-"));
      const expectedResult = expectedMode === "observe" ? "completed" : "failed";
      const stub = `globalThis.fetch = async (url, options) => {
        if (String(url).startsWith('https://monitor.example/')) {
          if (String(url) !== 'https://monitor.example/${role}${expectedResult === "failed" ? "/fail" : ""}') throw new Error('wrong monitor endpoint');
          if (JSON.stringify(JSON.parse(options.body)) !== JSON.stringify({role:'${role}',result:'${expectedResult}'})) throw new Error('wrong monitor payload');
          console.log('stubbed_mode_ping_${expectedResult}');
          return new Response('', {status:200});
        }
        if ('${expectedMode}' !== 'observe') throw new Error('worker work before mode validation');
        if (String(url) === 'https://www.stonkfun.xyz/api/public/v1/rewards?limit=100')
          return Response.json({data:{recentDistributions:[]}});
        if (String(url) === 'https://rpc.example/' && JSON.parse(options.body).method === 'getProgramAccounts')
          return Response.json({result:[]});
        throw new Error('unexpected network work');
      };`;
      try {
        const child = spawnSync(process.execPath, ["--experimental-strip-types", "--import",
          `data:text/javascript,${encodeURIComponent(stub)}`,
          fileURLToPath(new URL("../scripts/held-rewards.mts", import.meta.url)), `--role=${role}`], {
          encoding: "utf8", timeout: 15000,
          env: { ...process.env, HOLD_HEARTBEAT_MODE: expectedMode, HOLD_DATA_DIR: directory,
            HOLD_STOP_FILE: join(directory, "stop"), HOLD_ALERT_WEBHOOK: "", SOLANA_RPC_URL: "https://rpc.example/",
            NEXT_PUBLIC_ENDOWMENT_PROGRAM_ID: "HhJJRPcwABobT6jCEusieGuZxv6XvSKKvU32XyXASVF6",
            NEXT_PUBLIC_ENDOWMENT_CREATOR: "b5b42jEAoEj3WJnf2R29aPuKkkeUWmRLFsg1b8R3Fta",
            HOLD_COLLECTOR_HEARTBEAT_URL: "https://monitor.example/collector",
            HOLD_REVIEWER_HEARTBEAT_URL: "https://monitor.example/reviewer" },
        });
        assert.equal(child.error, undefined);
        assert.equal(child.status, expectedResult === "completed" ? 0 : 1, child.stderr + child.stdout);
        assert.match(child.stdout, new RegExp(`stubbed_mode_ping_${expectedResult}`));
        assert.match(child.stdout, /"heartbeat":"delivered"/);
        assert.doesNotMatch(child.stdout + child.stderr, /monitor\.example|rpc\.example/);
      } finally { rmSync(directory, { recursive: true, force: true }); }
    }
  }
});
