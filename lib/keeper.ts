import "server-only";
import { createHmac, randomInt } from "node:crypto";
import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import {
  fetchMaybeMint,
  fetchMaybeToken,
  getCreateAssociatedTokenIdempotentInstruction,
} from "@solana-program/token-2022";
import {
  ACTIVE_MAX_AGE_SECS,
  ata,
  authorityPda,
  base64ToBytes,
  beginCountIx,
  buybackIx,
  COUNT_INTERVAL_SECS,
  COUNT_TIMEOUT_SECS,
  countLandlordsIx,
  decodeConfig,
  fetchDecoded,
  finishCountIx,
  flagshipConfig,
  LEGACY_TOKEN_PROGRAM,
  listLandlords,
  MIN_DELEGATION,
  parsePool,
  pruneLandlordIx,
  refreshLandlordsIx,
  sweepIx,
  type EndowmentConfig,
  type Instance,
  type LandlordRow,
  type PoolAccounts,
} from "@/lib/endowment";
import { flagshipInstance } from "@/lib/solana";

type Rpc = ReturnType<typeof createSolanaRpc>;

export type Keeper = {
  rpc: Rpc;
  signer: KeyPairSigner;
  inst: Instance;
  /** Secret used only to draw unpredictable refresh times. */
  drawSecret: string;
  priorityMicroLamports: bigint;
};

/** Everything the keeper needs, or null until the launch settings are in place. */
export async function loadKeeper(): Promise<Keeper | null> {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  // Production-only, Sensitive environment variable (see docs/keeper.md).
  const secret = process.env.KEEPER_SECRET_KEY;
  const inst = await flagshipInstance();
  if (!rpcUrl || !secret || !inst) return null;
  return {
    rpc: createSolanaRpc(rpcUrl),
    signer: await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(secret))),
    inst,
    drawSecret: process.env.KEEPER_JITTER_SECRET ?? secret,
    priorityMicroLamports: BigInt(process.env.KEEPER_PRIORITY_MICROLAMPORTS ?? 5000),
  };
}

// ---- Sending ----

/** Each job returns within this, with whatever it managed (the route is capped at 60s). */
const BUDGET_MS = 50_000;
/** At most this many transactions in flight at once. */
const PARALLEL = 10;

/** Signs and sends without waiting for confirmation; returns the signature. */
async function submit(k: Keeper, ixs: Instruction[], computeUnits = 400_000): Promise<string> {
  const { value: blockhash } = await k.rpc.getLatestBlockhash().send();
  const budget = [
    getSetComputeUnitLimitInstruction({ units: computeUnits }),
    getSetComputeUnitPriceInstruction({ microLamports: k.priorityMicroLamports }),
  ];
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(k.signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions([...budget, ...ixs], m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  await k.rpc
    .sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64", skipPreflight: false })
    .send();
  return getSignatureFromTransaction(signed);
}

/** Waits for all of `signatures` together; each is confirmed, or has an error. */
async function confirmAll(k: Keeper, signatures: string[], deadline: number) {
  const result = new Map<string, string | null>();
  let waiting = signatures.filter(Boolean);
  while (waiting.length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const { value } = await k.rpc.getSignatureStatuses(waiting as never).send();
    const still: string[] = [];
    waiting.forEach((sig, i) => {
      const status = value[i];
      if (status?.err) result.set(sig, JSON.stringify(status.err));
      else if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) {
        result.set(sig, null);
      } else still.push(sig);
    });
    waiting = still;
  }
  for (const sig of waiting) result.set(sig, "not confirmed in time");
  return result;
}

/** Sends and confirms one transaction. */
async function send(k: Keeper, ixs: Instruction[], computeUnits?: number): Promise<string> {
  const sig = await submit(k, ixs, computeUnits);
  const err = (await confirmAll(k, [sig], Date.now() + 40_000)).get(sig);
  if (err) throw new Error(`Transaction ${sig} failed: ${err}`);
  return sig;
}

type Job<T> = { item: T; ixs: Instruction[]; computeUnits: number };
type Outcome<T> = { item: T; signature?: string; error?: string };

/**
 * Sends every job at once (up to PARALLEL in flight), then confirms them
 * together. Batches of one refresh or count land in the same slot or two,
 * leaving no time to move coin between them.
 */
async function sendAll<T>(k: Keeper, jobs: Job<T>[], deadline: number): Promise<Outcome<T>[]> {
  const out: Outcome<T>[] = [];
  for (let i = 0; i < jobs.length && Date.now() < deadline; i += PARALLEL) {
    const wave = jobs.slice(i, i + PARALLEL);
    const sent = await Promise.all(
      wave.map((j) =>
        submit(k, j.ixs, j.computeUnits).then(
          (signature) => ({ item: j.item, signature }) as Outcome<T>,
          (e) => ({ item: j.item, error: errMessage(e) }) as Outcome<T>,
        ),
      ),
    );
    const confirmed = await confirmAll(
      k,
      sent.flatMap((s) => (s.signature ? [s.signature] : [])),
      deadline,
    );
    for (const s of sent) {
      const err = s.signature ? confirmed.get(s.signature) : s.error;
      out.push(err ? { item: s.item, signature: s.signature, error: err } : s);
    }
  }
  return out;
}

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function readConfig(k: Keeper): Promise<EndowmentConfig> {
  const config = await fetchDecoded(k.rpc, k.inst.config, decodeConfig);
  if (!config) throw new Error("Endowment config not found");
  return config;
}

async function readPool(k: Keeper, config: EndowmentConfig): Promise<PoolAccounts> {
  const info = await k.rpc.getAccountInfo(config.pool, { encoding: "base64" }).send();
  if (!info.value) throw new Error("Pool account not found");
  return parsePool(base64ToBytes(info.value.data[0]));
}

const nowSecs = () => Math.floor(Date.now() / 1000);

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** A fresh random order, so which landlords share a transaction changes every time. */
function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Sweeps run while active and a count finished recently (`Config::sweeps_on`). */
function sweepsOn(config: EndowmentConfig, now: number) {
  return config.active && (config.params.activateBps === 0 || now - Number(config.lastCountAt) <= ACTIVE_MAX_AGE_SECS);
}

// ---- Sweeps (audit L-06, I-16) ----

/**
 * Sweep every landlord whose PUMP account holds more than its baseline. Sweeps
 * are sent together, a failed batch is retried one landlord at a time, and one
 * bad landlord never stops the others. The contract refuses sweeps whenever a
 * buyback couldn't run, so those land here as errors and nothing moves.
 */
export async function runSweeps(k: Keeper) {
  const deadline = Date.now() + BUDGET_MS;
  const config = await readConfig(k);
  const now = nowSecs();
  if (config.retired) return { skipped: "retired" };
  if (now < Number(config.pausedUntil)) return { skipped: "paused" };
  if (!sweepsOn(config, now)) return { skipped: "sweeps are off (commitment below the threshold, or no recent count)" };

  const [authority, poolAccounts, rows] = await Promise.all([
    authorityPda(k.inst.program, k.inst.config),
    readPool(k, config),
    listLandlords(k.rpc, k.inst.program, k.inst.config),
  ]);
  const tokens = await Promise.all(rows.map((r) => fetchMaybeToken(k.rpc, r.record.dividendAccount)));
  const due = rows.filter((row, i) => {
    const token = tokens[i];
    if (!token.exists || token.data.amount <= row.record.baseline) return false;
    const d = token.data.delegate;
    return d.__option === "Some" && d.value === authority;
  });

  const sweep = (row: LandlordRow) => sweepIx(k.inst, config.pool, poolAccounts, row.address, row.record.dividendAccount);
  const batches = await Promise.all(
    chunk(due, 3).map(async (batch) => ({ item: batch, ixs: await Promise.all(batch.map(sweep)), computeUnits: 80_000 * batch.length })),
  );
  const outcomes = await sendAll(k, batches, deadline);
  const signatures = outcomes.flatMap((o) => (o.error ? [] : [o.signature!]));
  const retry = outcomes.filter((o) => o.error).flatMap((o) => o.item);
  const singles = await sendAll(
    k,
    await Promise.all(retry.map(async (row) => ({ item: row, ixs: [await sweep(row)], computeUnits: 80_000 }))),
    deadline,
  );
  const failures = singles.filter((o) => o.error).map((o) => ({ landlord: o.item.address, error: o.error! }));
  signatures.push(...singles.flatMap((o) => (o.error ? [] : [o.signature!])));
  return { due: due.length, signatures, failures };
}

// ---- Buys (audit I-14, KW-11) ----

/**
 * Attempt one buyback once the contract's minimum interval has passed and the
 * vault holds at least the minimum buy. Anyone can call buyback, so the keeper
 * doesn't try to hide its timing: the protection is on-chain. The contract sizes
 * the buy and prices it against the pool's recorded time-weighted average; its
 * floor already enforces the worst acceptable fill, so min_out is 0.
 */
export async function runBuy(k: Keeper) {
  const config = await readConfig(k);
  const now = nowSecs();
  if (now < Number(config.pausedUntil)) return { skipped: "paused" };
  const due = Number(config.lastBuyAt) + Number(config.params.minBuyIntervalSecs);
  if (config.lastBuyAt > BigInt(0) && now < due) return { skipped: "not yet", nextAttemptAfter: due };

  const authority = await authorityPda(k.inst.program, k.inst.config);
  const vault = await fetchMaybeToken(k.rpc, await ata(authority, k.inst.dividendMint, k.inst.dividendTokenProgram));
  if (!vault.exists || vault.data.amount < config.params.minBuyAmount) return { skipped: "below the minimum buy" };

  const poolAccounts = await readPool(k, config);
  const keeperDividend = await ata(k.signer.address, k.inst.dividendMint, k.inst.dividendTokenProgram);
  const lpVault = await ata(authority, poolAccounts.lpMint, LEGACY_TOKEN_PROGRAM);
  // The flagship's vault, derived exactly as the program derives it (pinned constants).
  const flagship = await flagshipConfig();
  if (!flagship) throw new Error("Flagship config unknown");
  const flagshipVault = await ata(await authorityPda(k.inst.program, flagship), k.inst.dividendMint, k.inst.dividendTokenProgram);

  const ixs: Instruction[] = [
    getCreateAssociatedTokenIdempotentInstruction({
      payer: k.signer,
      owner: k.signer.address,
      mint: k.inst.dividendMint,
      ata: keeperDividend,
      tokenProgram: k.inst.dividendTokenProgram,
    }),
    // The LP vault, for the post-milestone liquidity share (until it exists, that share buys).
    getCreateAssociatedTokenIdempotentInstruction({
      payer: k.signer,
      owner: authority,
      mint: poolAccounts.lpMint,
      ata: lpVault,
      tokenProgram: LEGACY_TOKEN_PROGRAM,
    }),
    await buybackIx(k.inst, config.pool, poolAccounts, k.signer, keeperDividend, flagshipVault, config.donationBps > 0, BigInt(0)),
  ];
  return { signature: await send(k, ixs, 600_000) };
}

// ---- The refresher's pass (the anti-shuffle attestation) ----

/** Landlords per count or refresh transaction: three accounts each. */
const BATCH = 8;
const batchUnits = (n: number) => 30_000 + 15_000 * n;

/**
 * The refresher reads every landlord, all batches sent together, and a failed
 * batch is retried one landlord at a time. Only attested landlords count, so
 * this must run between counts; the keeper runs it at random times through the
 * day and right before each count. If this keeper isn't the endowment's
 * refresher, its refreshes still lower recorded balances but attest nothing.
 */
async function refreshPass(k: Keeper, deadline: number) {
  const landlords = await listLandlords(k.rpc, k.inst.program, k.inst.config);
  const jobs = chunk(shuffled(landlords), BATCH).map((batch) => ({
    item: batch,
    ixs: [refreshLandlordsIx(k.inst, k.signer, batch)],
    computeUnits: batchUnits(batch.length),
  }));
  const outcomes = await sendAll(k, jobs, deadline);
  const retry = outcomes.filter((o) => o.error).flatMap((o) => o.item);
  const singles = await sendAll(
    k,
    retry.map((row) => ({ item: row, ixs: [refreshLandlordsIx(k.inst, k.signer, [row])], computeUnits: batchUnits(1) })),
    deadline,
  );
  const failures = singles.filter((o) => o.error).map((o) => ({ landlord: o.item.address, error: o.error! }));
  return {
    landlords: landlords.length,
    read: landlords.length - failures.length,
    transactions: jobs.length,
    failures,
  };
}

/**
 * Called often by the scheduler; each call proceeds only on a secret-seeded
 * random draw (about `KEEPER_REFRESHES_PER_DAY` times a day).
 */
export async function runRefresh(k: Keeper, force = false) {
  const perDay = Number(process.env.KEEPER_REFRESHES_PER_DAY ?? 6);
  const tickMinutes = Number(process.env.KEEPER_REFRESH_TICK_MINUTES ?? 15);
  const ticksPerDay = Math.max(1, Math.floor((24 * 60) / tickMinutes));
  const tick = Math.floor(nowSecs() / (tickMinutes * 60));
  const draw = createHmac("sha256", k.drawSecret).update(`refresh:${k.inst.config}:${tick}`).digest().readUInt32BE(0);
  if (!force && draw % ticksPerDay >= perDay) return { skipped: "not this tick" };
  const config = await readConfig(k);
  const attests = config.params.refresher === k.signer.address;
  return { attests, ...(await refreshPass(k, Date.now() + BUDGET_MS)) };
}

// ---- The daily commitment count (audit M-07, KW-04) ----

/**
 * Run the daily count, resumably, within one invocation's time budget. When a
 * count is due: the refresher's pass, then begin (no pruning first: a landlord
 * that no longer qualifies simply counts zero). Then count every landlord the
 * open round still expects, all batches sent together, retrying failures one
 * at a time, and finish once complete or timed out.
 */
export async function runCount(k: Keeper) {
  const deadline = Date.now() + BUDGET_MS;
  let config = await readConfig(k);
  const now = nowSecs();
  if (now < Number(config.pausedUntil)) return { skipped: "paused" };
  const signatures: string[] = [];
  let refresh: Awaited<ReturnType<typeof refreshPass>> | null = null;

  if (!config.count.open) {
    const started = Number(config.count.startedAt);
    if (config.count.round > BigInt(0) && now - started < COUNT_INTERVAL_SECS) {
      return { skipped: "counted recently", lastCountAt: Number(config.lastCountAt), nextCountAfter: started + COUNT_INTERVAL_SECS };
    }
    if (config.params.refresher === k.signer.address) refresh = await refreshPass(k, deadline - 20_000);
    signatures.push(await send(k, [beginCountIx(k.inst)], 40_000));
    config = await readConfig(k);
  }

  const round = config.count.round;
  const pending = (await listLandlords(k.rpc, k.inst.program, k.inst.config)).filter(
    (l) => l.record.joinedRound < round && l.record.countedRound < round,
  );
  const outcomes = await sendAll(
    k,
    chunk(shuffled(pending), BATCH).map((batch) => ({
      item: batch,
      ixs: [countLandlordsIx(k.inst, batch)],
      computeUnits: batchUnits(batch.length),
    })),
    deadline,
  );
  signatures.push(...outcomes.flatMap((o) => (o.error ? [] : [o.signature!])));
  // One bad landlord (e.g. counted by someone else a moment ago) shouldn't stop the rest.
  const retry = outcomes.filter((o) => o.error).flatMap((o) => o.item);
  const singles = await sendAll(
    k,
    retry.map((row) => ({ item: row, ixs: [countLandlordsIx(k.inst, [row])], computeUnits: batchUnits(1) })),
    deadline,
  );
  signatures.push(...singles.flatMap((o) => (o.error ? [] : [o.signature!])));
  const failures = singles.filter((o) => o.error).map((o) => ({ landlord: o.item.address, error: o.error! }));

  const after = await readConfig(k);
  const complete = after.count.counted >= after.count.expected;
  const clockStart = Math.max(Number(after.count.startedAt), Number(after.pausedUntil));
  const timedOut = nowSecs() - clockStart >= COUNT_TIMEOUT_SECS;
  if (after.count.open && (complete || timedOut) && Date.now() < deadline) {
    signatures.push(await send(k, [finishCountIx(k.inst)], 40_000));
  }
  const final = await readConfig(k);
  return {
    round: Number(final.count.round),
    open: final.count.open,
    counted: final.count.counted,
    expected: final.count.expected,
    committedBps: final.lastCountBps,
    active: final.active,
    refresh,
    signatures,
    failures,
  };
}

// ---- Pruning (separate from the count, audit KW-04) ----

/**
 * Removes landlords that no longer qualify (revoked, or below the minimum
 * stake), reading them in parallel and pruning together, within the time
 * budget. Not needed for a correct count; it keeps the roster lean.
 */
export async function runPrune(k: Keeper) {
  const deadline = Date.now() + BUDGET_MS;
  const config = await readConfig(k);
  const authority = await authorityPda(k.inst.program, k.inst.config);
  const mint = await fetchMaybeMint(k.rpc, k.inst.coinMint);
  const supply = mint.exists ? mint.data.supply : BigInt(0);
  const minStake = (supply * BigInt(config.params.minStakeBps) + BigInt(9_999)) / BigInt(10_000);
  const rows = await listLandlords(k.rpc, k.inst.program, k.inst.config);
  const stale: LandlordRow[] = [];
  for (const group of chunk(rows, 50)) {
    if (Date.now() > deadline - 15_000) break;
    const checks = await Promise.all(
      group.map(async (row) => {
        const [dividend, coin] = await Promise.all([
          fetchMaybeToken(k.rpc, row.record.dividendAccount),
          fetchMaybeToken(k.rpc, row.record.coinAccount),
        ]);
        const owner = row.record.owner;
        const d = dividend.exists ? dividend.data : null;
        const delegated = Boolean(
          d && d.owner === owner && d.delegate.__option === "Some" && d.delegate.value === authority && d.delegatedAmount >= MIN_DELEGATION,
        );
        const held = coin.exists && coin.data.owner === owner ? coin.data.amount : BigInt(0);
        return delegated && held >= minStake;
      }),
    );
    group.forEach((row, i) => {
      if (!checks[i]) stale.push(row);
    });
  }
  const jobs = await Promise.all(
    stale.map(async (row) => ({ item: row, ixs: [await pruneLandlordIx(k.inst, row)], computeUnits: 60_000 })),
  );
  const outcomes = await sendAll(k, jobs, deadline);
  return {
    checked: rows.length,
    pruned: outcomes.filter((o) => !o.error).length,
    failures: outcomes.filter((o) => o.error).map((o) => ({ landlord: o.item.address, error: o.error! })),
  };
}

// ---- Health (audit KW-05, KW-13) ----

/** Count, attestation and sweep freshness, for alerting. */
export async function countHealth(k: Keeper) {
  const config = await readConfig(k);
  const now = nowSecs();
  const age = (t: bigint) => (t > BigInt(0) ? now - Number(t) : null);
  const countAge = age(config.lastCountAt);
  const attestAge = age(config.lastAttestedAt);
  const openFor = config.count.open ? now - Math.max(Number(config.count.startedAt), Number(config.pausedUntil)) : null;
  const refresherIsKeeper = config.params.refresher === k.signer.address;
  const countStale = (countAge !== null && countAge > 2 * COUNT_INTERVAL_SECS) || (openFor !== null && openFor > COUNT_TIMEOUT_SECS);
  // With landlords to attest, a refresher pass should land several times a day.
  const attestStale = refresherIsKeeper && config.landlordCount > 0 && (attestAge === null || attestAge > 12 * 60 * 60);
  return {
    round: Number(config.count.round),
    open: config.count.open,
    counted: config.count.counted,
    expected: config.count.expected,
    lastCountAt: Number(config.lastCountAt),
    countAgeSecs: countAge,
    refresherIsKeeper,
    lastAttestedAt: Number(config.lastAttestedAt),
    attestAgeSecs: attestAge,
    sweepsOn: sweepsOn(config, now),
    lastSweepAt: Number(config.lastSweepAt),
    sweepAgeSecs: age(config.lastSweepAt),
    stale: countStale || attestStale,
    countStale,
    attestStale,
  };
}
