import "server-only";
import { HOLD_COLLECTION_RELEASED } from "./holding/release";
import { createHmac, randomInt } from "node:crypto";
import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  type Base64EncodedWireTransaction,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
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
  attestationsOf,
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
  LEGACY_TOKEN_PROGRAM,
  listLandlords,
  MIN_ATTEST_SPACING_SECS,
  MIN_DELEGATION,
  parsePool,
  PROGRAM_ERRORS,
  pruneLandlordIx,
  refilledAllowance,
  refreshLandlordsIx,
  REQUIRED_ATTESTATIONS,
  type EndowmentConfig,
  type Instance,
  type LandlordRow,
  type PoolAccounts,
} from "@/lib/endowment";
import { deviationBps, reservedFees, spotPriceX32, twapPriceX32, x32ToNumber } from "@/lib/price";
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

/** Builds and signs one transaction. */
async function sign(k: Keeper, ixs: Instruction[], computeUnits = 400_000) {
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
  return { wire: getBase64EncodedWireTransaction(signed), signature: getSignatureFromTransaction(signed) as string };
}

/** Signs and sends without waiting for confirmation; returns the signature. */
async function submit(k: Keeper, ixs: Instruction[], computeUnits = 400_000): Promise<string> {
  const { wire, signature } = await sign(k, ixs, computeUnits);
  await k.rpc.sendTransaction(wire, { encoding: "base64", skipPreflight: false }).send();
  return signature;
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
 * Sends every job before confirming any (at most PARALLEL submissions in
 * flight, but never waiting for one wave to land before sending the next),
 * then confirms them all together. So every batch of a refresh pass or count
 * lands within a slot or two of the others, leaving no time to move coin
 * between wallets read in different batches (audit R3-RF-02).
 */
async function sendAll<T>(k: Keeper, jobs: Job<T>[], deadline: number): Promise<Outcome<T>[]> {
  const sent: Outcome<T>[] = [];
  for (let i = 0; i < jobs.length && Date.now() < deadline; i += PARALLEL) {
    const wave = jobs.slice(i, i + PARALLEL);
    sent.push(
      ...(await Promise.all(
        wave.map((j) =>
          submit(k, j.ixs, j.computeUnits).then(
            (signature) => ({ item: j.item, signature }) as Outcome<T>,
            (e) => ({ item: j.item, error: errMessage(e) }) as Outcome<T>,
          ),
        ),
      )),
    );
  }
  const confirmed = await confirmAll(
    k,
    sent.flatMap((s) => (s.signature ? [s.signature] : [])),
    deadline,
  );
  return sent.map((s) => {
    const err = s.signature ? confirmed.get(s.signature) : s.error;
    return err ? { item: s.item, signature: s.signature, error: err } : s;
  });
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

/** Collections require the separate, stateful collector/reviewer services. */
export async function runSweeps(k: Keeper) {
  void k;
  return { skipped: "Use the refundable collection worker; legacy balance sweeps are disabled" };
}

// ---- Buys (audit I-14, KW-11, R3-TW-02) ----

/** Slack under the simulated fill for `min_out` (1%). */
const MIN_OUT_SLACK_BPS = BigInt(100);

/** The program error in a simulation or send failure, by name where known. */
function programError(err: unknown) {
  const text = JSON.stringify(err, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  const code = Number(/"Custom":\s*"?(\d+)/.exec(text)?.[1]);
  return Number.isFinite(code) ? (PROGRAM_ERRORS[code] ?? `error ${code}`) : text;
}

/** Spot, TWAP and their deviation, as the program reads them, for the log of a skipped buy. */
async function priceReport(k: Keeper, config: EndowmentConfig, pool: PoolAccounts) {
  const dividendIndex = pool.mints[0] === k.inst.dividendMint ? 0 : 1;
  const [poolInfo, observation, dividendVault, coinVault] = await Promise.all([
    k.rpc.getAccountInfo(config.pool, { encoding: "base64" }).send(),
    k.rpc.getAccountInfo(pool.observation, { encoding: "base64" }).send(),
    fetchMaybeToken(k.rpc, pool.vaults[dividendIndex]),
    fetchMaybeToken(k.rpc, pool.vaults[1 - dividendIndex]),
  ]);
  if (!poolInfo.value || !observation.value || !dividendVault.exists || !coinVault.exists) return null;
  const poolBytes = base64ToBytes(poolInfo.value.data[0]);
  const spot = spotPriceX32(
    dividendVault.data.amount - reservedFees(poolBytes, dividendIndex),
    coinVault.data.amount - reservedFees(poolBytes, 1 - dividendIndex),
  );
  const twap = twapPriceX32(base64ToBytes(observation.value.data[0]), dividendIndex, BigInt(nowSecs()));
  return {
    spot: spot === null ? null : x32ToNumber(spot),
    twap: twap === null ? null : x32ToNumber(twap),
    deviationBps: spot !== null && twap !== null ? deviationBps(spot, twap) : null,
    bandBps: config.params.maxTwapDeviationBps,
  };
}

/**
 * Attempt one buyback once the contract's minimum interval has passed and the
 * vault holds at least the minimum buy. Scheduled every 5 minutes: the pool's
 * price is often outside the band for a while, so frequent attempts catch the
 * windows when it's inside. Each attempt is simulated first; if the contract
 * would refuse it, nothing is sent and the response logs spot, TWAP and their
 * deviation. Otherwise it's sent with `min_out` at the simulated fill less 1%,
 * so a caller can't be made to fill much worse than the pool's price right now
 * (the contract's own TWAP floor still applies on top).
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
  // The paced daily allowance, refilled as the program refills it: while it's
  // below the minimum buy (or empty) the program would refuse, so skip the
  // simulation and say when it will have refilled enough.
  const allowance = refilledAllowance(config, now);
  const needed = config.params.minBuyAmount > BigInt(0) ? config.params.minBuyAmount : BigInt(1);
  if (allowance < needed) {
    const perDay = config.params.maxBuyPerDay > BigInt(0) ? config.params.maxBuyPerDay : BigInt(1);
    const wait = Number(((needed - allowance) * BigInt(86_400) + perDay - BigInt(1)) / perDay);
    return { skipped: "daily allowance used", allowance: allowance.toString(), nextAttemptAfter: now + wait };
  }

  const poolAccounts = await readPool(k, config);
  const keeperDividend = await ata(k.signer.address, k.inst.dividendMint, k.inst.dividendTokenProgram);
  const lpVault = await ata(authority, poolAccounts.lpMint, LEGACY_TOKEN_PROGRAM);
  const coinVault = await ata(authority, k.inst.coinMint, k.inst.coinTokenProgram);
  const setup: Instruction[] = [
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
  ];
  const buy = (minOut: bigint) =>
    buybackIx(k.inst, config.pool, poolAccounts, k.signer, keeperDividend, minOut);

  // Simulate with no minimum, reading the coin vault afterwards.
  const coinBefore = await fetchMaybeToken(k.rpc, coinVault);
  const { wire } = await sign(k, [...setup, await buy(BigInt(0))], 600_000);
  const sim = await k.rpc
    .simulateTransaction(wire as Base64EncodedWireTransaction, {
      encoding: "base64",
      sigVerify: false,
      replaceRecentBlockhash: true,
      accounts: { addresses: [coinVault], encoding: "base64" },
    })
    .send();
  if (sim.value.err) {
    return { skipped: programError(sim.value.err), price: await priceReport(k, config, poolAccounts) };
  }
  const after = sim.value.accounts?.[0];
  const before = coinBefore.exists ? coinBefore.data.amount : BigInt(0);
  const afterAmount = after ? new DataView(base64ToBytes(after.data[0]).buffer).getBigUint64(64, true) : before;
  const simulated = afterAmount > before ? afterAmount - before : BigInt(0);
  const minOut = (simulated * (BigInt(10_000) - MIN_OUT_SLACK_BPS)) / BigInt(10_000);
  const signature = await send(k, [...setup, await buy(minOut)], 600_000);
  return { signature, simulatedOut: simulated.toString(), minOut: minOut.toString() };
}

// ---- The refresher's pass (the anti-shuffle attestation) ----

/** Landlords per count or refresh transaction: four accounts each. */
const BATCH = 6;
const batchUnits = (n: number) => 35_000 + 25_000 * n;

/**
 * The refresher reads every landlord (or those given), in a fresh random order,
 * every batch sent before any is confirmed, and a failed batch is retried one
 * landlord at a time. A landlord counts only after REQUIRED_ATTESTATIONS such
 * reads at least MIN_ATTEST_SPACING_SECS apart since its last count, so the
 * keeper runs several independently shuffled passes a day at random times, and
 * tops up landlords still short of reads when a count is open. If this keeper
 * isn't the endowment's refresher, its refreshes still lower recorded balances
 * but attest nothing.
 */
async function refreshPass(k: Keeper, deadline: number, only?: LandlordRow[]) {
  const landlords = only ?? (await listLandlords(k.rpc, k.inst.program, k.inst.config));
  const jobs = await Promise.all(chunk(shuffled(landlords), BATCH).map(async (batch) => ({
    item: batch,
    ixs: [await refreshLandlordsIx(k.inst, k.signer, batch)],
    computeUnits: batchUnits(batch.length),
  })));
  const outcomes = await sendAll(k, jobs, deadline);
  const retry = outcomes.filter((o) => o.error).flatMap((o) => o.item);
  const singles = await sendAll(
    k,
    await Promise.all(retry.map(async (row) => ({ item: row, ixs: [await refreshLandlordsIx(k.inst, k.signer, [row])], computeUnits: batchUnits(1) }))),
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
 * random draw (about `KEEPER_REFRESHES_PER_DAY` times a day), so passes land at
 * times nobody can predict. The default of 8 leaves plenty of spaced passes
 * between counts for every landlord to reach its REQUIRED_ATTESTATIONS reads.
 */
export async function runRefresh(k: Keeper, force = false) {
  const perDay = Number(process.env.KEEPER_REFRESHES_PER_DAY ?? 8);
  const tickMinutes = Number(process.env.KEEPER_REFRESH_TICK_MINUTES ?? 15);
  const ticksPerDay = Math.max(1, Math.floor((24 * 60) / tickMinutes));
  const tick = Math.floor(nowSecs() / (tickMinutes * 60));
  const draw = createHmac("sha256", k.drawSecret).update(`refresh:${k.inst.config}:${tick}`).digest().readUInt32BE(0);
  if (!force && draw % ticksPerDay >= perDay) return { skipped: "not this tick" };
  const config = await readConfig(k);
  const attests = config.params.refresher === k.signer.address;
  return { attests, ...(await refreshPass(k, Date.now() + BUDGET_MS)) };
}

// ---- The daily commitment count (audit M-07, KW-04, R3-RF-03) ----

/**
 * Whether the refresher may add a read to this landlord now (`count::refresh_landlords`).
 * Reads from an earlier refresher epoch are reset, so the next read always lands.
 */
const readDue = (config: EndowmentConfig, l: LandlordRow, now: number) =>
  attestationsOf(config, l.record) === 0 || now - Number(l.record.lastAttestedAt) >= MIN_ATTEST_SPACING_SECS;

/**
 * Run the daily count, resumably, within one invocation's time budget. When a
 * count is due: a refresher pass (the contract only lets a round begin after
 * one), then begin. While a round is open: first refresh every landlord it
 * still expects that is short of its reads and due another, then count them
 * all, every batch sent before any is confirmed, retrying failures one at a
 * time. The contract leaves a landlord still short of reads pending rather
 * than counting it as zero, and the next call (every 15 minutes) reads it
 * again, 30 minutes after its last read, until it counts. The round finishes
 * once complete or timed out. No pruning first: a landlord that no longer
 * qualifies simply counts zero.
 */
export async function runCount(k: Keeper) {
  const deadline = Date.now() + BUDGET_MS;
  let config = await readConfig(k);
  const now = nowSecs();
  if (now < Number(config.pausedUntil)) return { skipped: "paused" };
  const isRefresher = config.params.refresher === k.signer.address;
  const signatures: string[] = [];
  let refresh: Awaited<ReturnType<typeof refreshPass>> | null = null;

  if (!config.count.open) {
    const started = Number(config.count.startedAt);
    if (config.count.round > BigInt(0) && now - started < COUNT_INTERVAL_SECS) {
      return { skipped: "counted recently", lastCountAt: Number(config.lastCountAt), nextCountAfter: started + COUNT_INTERVAL_SECS };
    }
    if (isRefresher) refresh = await refreshPass(k, deadline - 25_000);
    signatures.push(await send(k, [beginCountIx(k.inst)], 40_000));
    config = await readConfig(k);
  }

  const round = config.count.round;
  const expected = () =>
    listLandlords(k.rpc, k.inst.program, k.inst.config).then((rows) =>
      rows.filter((l) => l.record.joinedRound < round && l.record.countedRound < round),
    );
  let pending = await expected();
  // Top up landlords still short of their reads (R3-RF-03), then re-read them.
  const short = pending.filter(
    (l) => attestationsOf(config, l.record) < REQUIRED_ATTESTATIONS && readDue(config, l, nowSecs()),
  );
  if (isRefresher && short.length > 0 && !refresh) {
    refresh = await refreshPass(k, deadline - 25_000, short);
    pending = await expected();
  }
  const outcomes = await sendAll(
    k,
    await Promise.all(chunk(shuffled(pending), BATCH).map(async (batch) => ({
      item: batch,
      ixs: [await countLandlordsIx(k.inst, batch)],
      computeUnits: batchUnits(batch.length),
    }))),
    deadline,
  );
  signatures.push(...outcomes.flatMap((o) => (o.error ? [] : [o.signature!])));
  // One bad landlord (e.g. counted by someone else a moment ago) shouldn't stop the rest.
  const retry = outcomes.filter((o) => o.error).flatMap((o) => o.item);
  const singles = await sendAll(
    k,
    await Promise.all(retry.map(async (row) => ({ item: row, ixs: [await countLandlordsIx(k.inst, [row])], computeUnits: batchUnits(1) }))),
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
    // Left for a later call: short of the refresher's reads.
    waitingForReads: final.count.open ? final.count.expected - final.count.counted : 0,
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
    sweepsOn: HOLD_COLLECTION_RELEASED && sweepsOn(config, now),
    collectionWorkerReleased: HOLD_COLLECTION_RELEASED,
    lastSweepAt: Number(config.lastSweepAt),
    sweepAgeSecs: age(config.lastSweepAt),
    stale: countStale || attestStale,
    countStale,
    attestStale,
  };
}
