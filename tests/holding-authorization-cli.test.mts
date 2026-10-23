import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { archiveFeed } from "../lib/holding/feed.ts";

// Exercise the real CLI stop persistence across processes; isolate the wallet
// result so zero eligibility cannot accidentally hide a missing stop control.
for (const incident of ["uncertain_history", "pending_over_30h"] as const) {
test(`authorizing reviewer persists ${incident} stops even with no eligible rewards`, async () => {
  const directory = await mkdtemp(join(tmpdir(), "reviewer-quarantine-"));
  const codec = new URL("../lib/holding/codec.ts", import.meta.url).href;
  const endowment = new URL("../lib/endowment.ts", import.meta.url).href;
  const client = new URL("../lib/holding/client.ts", import.meta.url).href;
  const run = (unhealthy: boolean) => {
    const workerSource = `export async function walletTick(options) {
      options.observe({kind:'observations',observations:${unhealthy && incident === "uncertain_history" ? `[{signature:'unknown',slot:1,
        before:'10',after:'10',amount:'0',kind:'uncertain',reason:'Unexplained token activity'}]` : "[]"}});
      return {status:'reviewed',outcomes:[],authorization:{status:'idle'}};
    }`;
    const stub = `import {registerHooks} from 'node:module';
      import {concat,encode,schema} from ${JSON.stringify(codec)};
      import {flagshipConfig,PROGRAM_ID} from ${JSON.stringify(endowment)};
      import {holdPda} from ${JSON.stringify(client)};
      const config=await flagshipConfig();
      const owner='11111111111111111111111111111111';
      const consent=Buffer.from(concat(Uint8Array.from(schema.accounts.CollectionConsent),encode({defined:{name:'CollectionConsent'}},
        {config,owner,bump:0,enabled:true,epoch:1n,next_nonce:0n,started_at:1n}))).toString('base64');
      const pending=[];
      if (${unhealthy && incident === "pending_over_30h"}) {
        const at=BigInt(Math.floor(Date.now()/1000)-108001);
        const receipt={config,owner,payer:owner,nonce:0n,consent_epoch:1n,amount:1n,
          collected_at:at,release_at:at+86400n,refund_at:at+259200n,collection_evidence:Array(32).fill(1),
          reviewed:false,approved_amount:0n,review_evidence:Array(32).fill(0),bump:0};
        const data=Buffer.from(concat(Uint8Array.from(schema.accounts.PendingCollection),
          encode({defined:{name:'PendingCollection'}},receipt))).toString('base64');
        pending.push({pubkey:await holdPda({program:PROGRAM_ID,config},'receipt',owner,0n),account:{owner:PROGRAM_ID,data:[data,'base64']}});
      }
      registerHooks({load(url,context,nextLoad){if(url.endsWith('/lib/holding/worker.ts'))
        return {format:'module',shortCircuit:true,source:${JSON.stringify(workerSource)}};return nextLoad(url,context);}});
      let rpcCalls=0;
      globalThis.fetch=async(url,options)=>{
        if(String(url)==='https://rpc.example/' && JSON.parse(options.body).method==='getProgramAccounts')
          return Response.json({result:++rpcCalls===1?pending:[{account:{owner:PROGRAM_ID,data:[consent,'base64']}}]});
        throw Error('Unexpected network request');
      };`;
    return spawnSync(process.execPath, ["--experimental-strip-types", "--import", `data:text/javascript,${encodeURIComponent(stub)}`,
      fileURLToPath(new URL("../scripts/held-rewards.mts", import.meta.url)), "--role=reviewer", "--authorize", "--mode=public"], {
      encoding: "utf8", timeout: 15000, env: { ...process.env, HOLD_DATA_DIR: directory,
        HOLD_STOP_FILE: join(directory, "collection.stop"), HOLD_ALERT_WEBHOOK: "", SOLANA_RPC_URL: "https://rpc.example/",
        HOLD_KEYPAIR_FILE: "/must-not-read-a-signer", HOLD_COLLECTOR_HEARTBEAT_URL: "", HOLD_REVIEWER_HEARTBEAT_URL: "",
        NEXT_PUBLIC_ENDOWMENT_PROGRAM_ID: "HhJJRPcwABobT6jCEusieGuZxv6XvSKKvU32XyXASVF6",
        NEXT_PUBLIC_ENDOWMENT_CREATOR: "b5b42jEAoEj3WJnf2R29aPuKkkeUWmRLFsg1b8R3Fta" },
    });
  };
  try {
    await archiveFeed(directory, { request: (async () => Response.json({ rows: [], page: { limit: 100, order: "desc", nextCursor: null } },
      { headers: { date: new Date().toUTCString() } })) as typeof fetch });
    const first = run(true);
    assert.equal(first.error, undefined);
    assert.equal(first.status, 1, first.stdout + first.stderr);
    assert.match(first.stdout, /"authorization":\{"status":"idle"\}/);
    assert.match(first.stdout, new RegExp(incident));
    const stop = await readFile(join(directory, "collection.stop"), "utf8");
    assert.equal(JSON.parse(stop).code, incident === "uncertain_history" ? "history_evidence_gap" : "pending_over_30h");
    const restarted = run(false);
    assert.equal(restarted.error, undefined);
    assert.equal(restarted.status, 1, restarted.stdout + restarted.stderr);
    assert.match(restarted.stdout, /collection_quarantined/);
    assert.equal(await readFile(join(directory, "collection.stop"), "utf8"), stop);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
}

for (const configuration of ["missing_mode", "missing_founders_file"] as const) {
test(`reviewer ${configuration} blocks grants but still runs the submitting recovery pass`, async () => {
  const directory = await mkdtemp(join(tmpdir(), "reviewer-grant-config-"));
  const codec = new URL("../lib/holding/codec.ts", import.meta.url).href;
  const endowment = new URL("../lib/endowment.ts", import.meta.url).href;
  const workerSource = `export async function walletTick(options) {
    if (!options.submit || options.authorizeCollections) throw Error('Recovery disabled or grants enabled');
    return {status:'reviewed',outcomes:[{action:'refund',result:'submitted'}],authorization:{status:'disabled'}};
  }`;
  const stub = `import {registerHooks} from 'node:module';
    import {concat,encode,schema} from ${JSON.stringify(codec)};
    import {flagshipConfig,PROGRAM_ID} from ${JSON.stringify(endowment)};
    const config=await flagshipConfig(), owner='11111111111111111111111111111111';
    const consent=Buffer.from(concat(Uint8Array.from(schema.accounts.CollectionConsent),encode({defined:{name:'CollectionConsent'}},
      {config,owner,bump:0,enabled:true,epoch:1n,next_nonce:0n,started_at:1n}))).toString('base64');
    registerHooks({load(url,context,nextLoad){
      if(url.endsWith('/lib/holding/worker.ts')) return {format:'module',shortCircuit:true,source:${JSON.stringify(workerSource)}};
      if(url.endsWith('/lib/holding/release.ts')) return {format:'module',shortCircuit:true,source:'export const HOLD_COLLECTION_RELEASED = true;'};
      return nextLoad(url,context);
    }});
    let calls=0;
    globalThis.fetch=async(url,options)=>{
      if(String(url)==='https://rpc.example/' && JSON.parse(options.body).method==='getProgramAccounts')
        return Response.json({result:++calls===1?[]:[{account:{owner:PROGRAM_ID,data:[consent,'base64']}}]});
      throw Error('Unexpected network request');
    };`;
  try {
    await archiveFeed(directory, { request: (async () => Response.json({ rows: [], page: { limit: 100, order: "desc", nextCursor: null } },
      { headers: { date: new Date().toUTCString() } })) as typeof fetch });
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--import", `data:text/javascript,${encodeURIComponent(stub)}`,
      fileURLToPath(new URL("../scripts/held-rewards.mts", import.meta.url)), "--role=reviewer", "--authorize", "--submit",
      ...(configuration === "missing_founders_file" ? ["--mode=founders"] : [])], {
      encoding: "utf8", timeout: 15000, env: { ...process.env, HOLD_DATA_DIR: directory,
        HOLD_STOP_FILE: join(directory, "collection.stop"), HOLD_FOUNDERS_FILE: "", HOLD_ALERT_WEBHOOK: "", SOLANA_RPC_URL: "https://rpc.example/",
        HOLD_KEYPAIR_FILE: "/must-not-read-a-signer", HOLD_COLLECTOR_HEARTBEAT_URL: "", HOLD_REVIEWER_HEARTBEAT_URL: "",
        NEXT_PUBLIC_ENDOWMENT_PROGRAM_ID: "HhJJRPcwABobT6jCEusieGuZxv6XvSKKvU32XyXASVF6",
        NEXT_PUBLIC_ENDOWMENT_CREATOR: "b5b42jEAoEj3WJnf2R29aPuKkkeUWmRLFsg1b8R3Fta" },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /"authorization":\{"status":"disabled"\}/);
    assert.match(result.stdout, /"processed":1/);
    assert.match(result.stdout, /authorization_configuration/);
    assert.doesNotMatch(result.stdout, /pass_failure|wallet_failure/);
    assert.equal(JSON.parse(await readFile(join(directory, "collection.stop"), "utf8")).code, "authorization_configuration");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
}
