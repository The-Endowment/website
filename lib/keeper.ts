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
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import {
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
  parsePool,
  pruneLandlordIx,
  refreshLandlordsIx,
  sweepIx,
  type EndowmentConfig,
  type Instance,
  type LandlordRow,
} from "@/lib/endowment";
import { flagshipInstance } from "@/lib/solana";

type Rpc = ReturnType<typeof createSolanaRpc>;

export type Keeper = {
  rpc: Rpc;
  signer: KeyPairSigner;
  inst: Instance;
  /** Secret used only to derive unpredictable buy times. */
  jitterSecret: string;
  jitterSecs: number;
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
    jitterSecret: process.env.KEEPER_JITTER_SECRET ?? secret,
    jitterSecs: Number(process.env.KEEPER_BUY_JITTER_SECS ?? 1200),
    priorityMicroLamports: BigInt(process.env.KEEPER_PRIORITY_MICROLAMPORTS ?? 5000),
  };
}

// ---- Sending ----

async function send(k: Keeper, ixs: Instruction[], opts: { computeUnits?: number } = {}): Promise<string> {
  const { value: blockhash } = await k.rpc.getLatestBlockhash().send();
  const budget = [
    getSetComputeUnitLimitInstruction({ units: opts.computeUnits ?? 400_000 }),
    getSetComputeUnitPriceInstruction({ microLamports: k.priorityMicroLamports }),
  ];
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(k.signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions([...budget, ...ixs], m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signed);
  await k.rpc
    .sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64", skipPreflight: false })
    .send();
  // Wait for confirmation (up to ~40s).
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const { value } = await k.rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err) throw new Error(`Transaction ${signature} failed: ${JSON.stringify(status.err)}`);
    if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) {
      return signature;
    }
  }
  throw new Error(`Transaction ${signature} not confirmed in time`);
}

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function readConfig(k: Keeper): Promise<EndowmentConfig> {
  const config = await fetchDecoded(k.rpc, k.inst.config, decodeConfig);
  if (!config) throw new Error("Endowment config not found");
  return config;
}

const nowSecs = () => Math.floor(Date.now() / 1000);

// ---- Sweeps (audit L-06, I-16) ----

/**
 * Sweep every landlord whose PUMP account holds more than its baseline. Sweeps
 * are batched, a failed batch is retried one landlord at a time, and one bad
 * landlord never stops the others.
 */
export async function runSweeps(k: Keeper) {
  const config = await readConfig(k);
  const now = nowSecs();
  if (!config.active) return { skipped: "sweeps are off until the commitment threshold is met" };
  if (config.retired) return { skipped: "retired" };
  if (now < Number(config.pausedUntil)) return { skipped: "paused" };

  const authority = await authorityPda(k.inst.program, k.inst.config);
  const rows = await listLandlords(k.rpc, k.inst.program, k.inst.config);

  const due: { landlord: Address; dividendAccount: Address }[] = [];
  for (const row of rows) {
    const landlord = row.record;
    const token = await fetchMaybeToken(k.rpc, landlord.dividendAccount);
    if (!token.exists || token.data.amount <= landlord.baseline) continue;
    const d = token.data.delegate;
    if (d.__option !== "Some" || d.value !== authority) continue;
    due.push({ landlord: row.address, dividendAccount: landlord.dividendAccount });
  }

  const signatures: string[] = [];
  const failures: { landlord: Address; error: string }[] = [];
  const BATCH = 3;
  for (let i = 0; i < due.length; i += BATCH) {
    const batch = due.slice(i, i + BATCH);
    const ixs = await Promise.all(batch.map((d) => sweepIx(k.inst, d.landlord, d.dividendAccount)));
    try {
      signatures.push(await send(k, ixs, { computeUnits: 60_000 * batch.length }));
    } catch {
      for (const [j, one] of ixs.entries()) {
        try {
          signatures.push(await send(k, [one], { computeUnits: 60_000 }));
        } catch (e) {
          failures.push({ landlord: batch[j].landlord, error: errMessage(e) });
        }
      }
    }
  }
  return { due: due.length, signatures, failures };
}

// ---- Buys (audit I-14, and the keeper side of M-03) ----

/**
 * The earliest time this keeper will attempt the next buy: the contract's
 * minimum interval plus a jitter derived from a secret and the last buy time.
 * Outsiders can't predict it, and it changes after every buy.
 */
function nextBuyAt(k: Keeper, config: EndowmentConfig) {
  const last = Number(config.lastBuyAt);
  const h = createHmac("sha256", k.jitterSecret).update(`${k.inst.config}:${last}`).digest();
  const jitter = h.readUInt32BE(0) % Math.max(1, k.jitterSecs);
  return last + Number(config.params.minBuyIntervalSecs) + jitter;
}

/**
 * Attempt one buyback when the vault holds at least the minimum buy and the
 * randomized time has come. The contract sizes the buy, prices it against the
 * pool's time-weighted average price, and tips this wallet on success; min_out
 * is left at 0 because the on-chain floor is the protection.
 */
export async function runBuy(k: Keeper) {
  const config = await readConfig(k);
  const now = nowSecs();
  if (now < Number(config.pausedUntil)) return { skipped: "paused" };
  const due = nextBuyAt(k, config);
  if (now < due) return { skipped: "not yet", nextAttemptAfter: due };

  const authority = await authorityPda(k.inst.program, k.inst.config);
  const vault = await fetchMaybeToken(k.rpc, await ata(authority, k.inst.dividendMint, k.inst.dividendTokenProgram));
  if (!vault.exists || vault.data.amount < config.params.minBuyAmount) return { skipped: "below the minimum buy" };

  const poolInfo = await k.rpc.getAccountInfo(config.pool, { encoding: "base64" }).send();
  if (!poolInfo.value) throw new Error("Pool account not found");
  const poolAccounts = parsePool(base64ToBytes(poolInfo.value.data[0]));

  const keeperDividend = await ata(k.signer.address, k.inst.dividendMint, k.inst.dividendTokenProgram);
  const lpVault = await ata(authority, poolAccounts.lpMint, LEGACY_TOKEN_PROGRAM);
  const flagship = await flagshipConfig();
  if (!flagship) throw new Error("Flagship config unknown");
  const flagshipVault = await ata(await authorityPda(k.inst.program, flagship), k.inst.dividendMint, TOKEN_2022_PROGRAM_ADDRESS);

  const ixs: Instruction[] = [
    getCreateAssociatedTokenIdempotentInstruction({
      payer: k.signer,
      owner: k.signer.address,
      mint: k.inst.dividendMint,
      ata: keeperDividend,
      tokenProgram: k.inst.dividendTokenProgram,
    }),
    // The LP vault must exist once the milestone is reached; creating it is permissionless.
    getCreateAssociatedTokenIdempotentInstruction({
      payer: k.signer,
      owner: authority,
      mint: poolAccounts.lpMint,
      ata: lpVault,
      tokenProgram: LEGACY_TOKEN_PROGRAM,
    }),
    await buybackIx(k.inst, config.pool, poolAccounts, k.signer, keeperDividend, flagshipVault, BigInt(0)),
  ];
  return { signature: await send(k, ixs, { computeUnits: 600_000 }) };
}

// ---- The daily commitment count (audit M-07) ----

/** Landlords per count or refresh transaction: three accounts each (two for refresh). */
const COUNT_BATCH = 8;
const REFRESH_BATCH = 14;

/** A fresh random order, so which landlords share a transaction changes every time. */
function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Does this landlord still qualify: delegated to this endowment and holding the minimum stake? */
async function qualifies(k: Keeper, row: LandlordRow, authority: Address, minStake: bigint) {
  const [dividend, coin] = await Promise.all([
    fetchMaybeToken(k.rpc, row.record.dividendAccount),
    fetchMaybeToken(k.rpc, row.record.coinAccount),
  ]);
  const d = dividend.exists ? dividend.data.delegate : null;
  const delegated = Boolean(d && d.__option === "Some" && d.value === authority);
  const held = coin.exists ? coin.data.amount : BigInt(0);
  return delegated && held >= minStake;
}

/**
 * Run the daily count, resumably. If a round is open (started by anyone), count
 * whoever it still expects and finish it, after its timeout if some can't be
 * counted. If none is open and one is due, prune landlords that no longer
 * qualify, begin, count everyone in shuffled batches, and finish.
 */
export async function runCount(k: Keeper) {
  let config = await readConfig(k);
  const now = nowSecs();
  if (now < Number(config.pausedUntil)) return { skipped: "paused" };
  const signatures: string[] = [];
  const failures: { landlord: Address; error: string }[] = [];
  let pruned = 0;

  if (!config.count.open) {
    const started = Number(config.count.startedAt);
    if (config.count.round > BigInt(0) && now - started < COUNT_INTERVAL_SECS) {
      return { skipped: "counted recently", lastCountAt: Number(config.lastCountAt), nextCountAfter: started + COUNT_INTERVAL_SECS };
    }
    // Prune first, so the count doesn't keep reading landlords that left in all but name.
    const authority = await authorityPda(k.inst.program, k.inst.config);
    const mint = await fetchMaybeMint(k.rpc, k.inst.coinMint);
    const supply = mint.exists ? mint.data.supply : BigInt(0);
    const minStake = (supply * BigInt(config.params.minStakeBps) + BigInt(9_999)) / BigInt(10_000);
    for (const row of await listLandlords(k.rpc, k.inst.program, k.inst.config)) {
      if (await qualifies(k, row, authority, minStake)) continue;
      try {
        signatures.push(await send(k, [await pruneLandlordIx(k.inst, row)], { computeUnits: 60_000 }));
        pruned++;
      } catch (e) {
        failures.push({ landlord: row.address, error: errMessage(e) });
      }
    }
    signatures.push(await send(k, [beginCountIx(k.inst)], { computeUnits: 40_000 }));
    config = await readConfig(k);
  }

  const round = config.count.round;
  const pending = (await listLandlords(k.rpc, k.inst.program, k.inst.config)).filter(
    (l) => l.record.joinedRound < round && l.record.countedRound < round,
  );
  for (const batch of chunk(shuffled(pending), COUNT_BATCH)) {
    try {
      signatures.push(await send(k, [countLandlordsIx(k.inst, batch)], { computeUnits: 20_000 + 12_000 * batch.length }));
    } catch {
      // One bad landlord (e.g. counted by someone else a moment ago) shouldn't stop the rest.
      for (const one of batch) {
        try {
          signatures.push(await send(k, [countLandlordsIx(k.inst, [one])], { computeUnits: 40_000 }));
        } catch (e) {
          failures.push({ landlord: one.address, error: errMessage(e) });
        }
      }
    }
  }

  const after = await readConfig(k);
  const complete = after.count.counted >= after.count.expected;
  const timedOut = nowSecs() - Number(after.count.startedAt) >= COUNT_TIMEOUT_SECS;
  if (after.count.open && (complete || timedOut)) {
    signatures.push(await send(k, [finishCountIx(k.inst)], { computeUnits: 40_000 }));
  }
  const final = await readConfig(k);
  return {
    round: Number(final.count.round),
    open: final.count.open,
    counted: final.count.counted,
    expected: final.count.expected,
    committedBps: final.lastCountBps,
    active: final.active,
    pruned,
    signatures,
    failures,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Refresh every landlord's recorded balance (decrease-only) at a random moment.
 * Called often by the scheduler; each call proceeds only on a secret-seeded
 * random draw (about `KEEPER_REFRESHES_PER_DAY` times a day), and batches
 * landlords in a fresh random order, so coin can't be timed to sit in two
 * landlord wallets at every read.
 */
export async function runRefresh(k: Keeper, force = false) {
  const perDay = Number(process.env.KEEPER_REFRESHES_PER_DAY ?? 6);
  const tickMinutes = Number(process.env.KEEPER_REFRESH_TICK_MINUTES ?? 15);
  const ticksPerDay = Math.max(1, Math.floor((24 * 60) / tickMinutes));
  const tick = Math.floor(nowSecs() / (tickMinutes * 60));
  const draw = createHmac("sha256", k.jitterSecret).update(`refresh:${k.inst.config}:${tick}`).digest().readUInt32BE(0);
  if (!force && draw % ticksPerDay >= perDay) return { skipped: "not this tick" };

  const landlords = await listLandlords(k.rpc, k.inst.program, k.inst.config);
  const signatures: string[] = [];
  const failures: string[] = [];
  for (const batch of chunk(shuffled(landlords.filter((l) => l.record.snapshotValid)), REFRESH_BATCH)) {
    try {
      signatures.push(await send(k, [refreshLandlordsIx(k.inst, batch)], { computeUnits: 20_000 + 6_000 * batch.length }));
    } catch (e) {
      failures.push(errMessage(e));
    }
  }
  return { landlords: landlords.length, signatures, failures };
}

/** Count freshness, for alerting on a stalled or overdue count. */
export async function countHealth(k: Keeper) {
  const config = await readConfig(k);
  const now = nowSecs();
  const last = Number(config.lastCountAt);
  const age = last > 0 ? now - last : null;
  const openFor = config.count.open ? now - Number(config.count.startedAt) : null;
  return {
    round: Number(config.count.round),
    open: config.count.open,
    counted: config.count.counted,
    expected: config.count.expected,
    lastCountAt: last,
    ageSecs: age,
    stale: (age !== null && age > 2 * COUNT_INTERVAL_SECS) || (openFor !== null && openFor > COUNT_TIMEOUT_SECS),
  };
}
