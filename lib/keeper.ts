import "server-only";
import { createHmac } from "node:crypto";
import {
  appendTransactionMessageInstructions,
  compressTransactionMessageUsingAddressLookupTables,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getBase58Decoder,
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
  ADDRESS_LOOKUP_TABLE_PROGRAM_ADDRESS,
  fetchMaybeAddressLookupTable,
  getCreateLookupTableInstructionAsync,
  getExtendLookupTableInstruction,
} from "@solana-program/address-lookup-table";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import {
  fetchMaybeToken,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import {
  ata,
  authorityPda,
  base64ToBytes,
  buybackIx,
  COUNT_INTERVAL_SECS,
  countCommitmentIx,
  decodeConfig,
  decodeLandlord,
  decodeRoster,
  DISC,
  fetchDecoded,
  flagshipConfig,
  LEGACY_TOKEN_PROGRAM,
  parsePool,
  rosterPda,
  sweepIx,
  type EndowmentConfig,
  type Instance,
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

async function send(
  k: Keeper,
  ixs: Instruction[],
  opts: { computeUnits?: number; lookupTables?: Record<Address, Address[]> } = {},
): Promise<string> {
  const { value: blockhash } = await k.rpc.getLatestBlockhash().send();
  const budget = [
    getSetComputeUnitLimitInstruction({ units: opts.computeUnits ?? 400_000 }),
    getSetComputeUnitPriceInstruction({ microLamports: k.priorityMicroLamports }),
  ];
  let message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(k.signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions([...budget, ...ixs], m),
  );
  if (opts.lookupTables) {
    message = compressTransactionMessageUsingAddressLookupTables(message, opts.lookupTables) as typeof message;
  }
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
  const discB58 = getBase58Decoder().decode(new Uint8Array(DISC.landlordAccount));
  type Row = { pubkey: Address; account: { data: [string, string] } };
  const rows = (await k.rpc
    .getProgramAccounts(k.inst.program, {
      encoding: "base64",
      filters: [
        { memcmp: { offset: BigInt(0), bytes: discB58, encoding: "base58" } },
        // Landlord.config sits right after the discriminator and version byte.
        { memcmp: { offset: BigInt(9), bytes: k.inst.config, encoding: "base58" } },
      ],
    } as never)
    .send()) as unknown as Row[];

  const due: { landlord: Address; dividendAccount: Address }[] = [];
  for (const row of rows) {
    const landlord = decodeLandlord(base64ToBytes(row.account.data[0]));
    if (!landlord) continue;
    const token = await fetchMaybeToken(k.rpc, landlord.dividendAccount);
    if (!token.exists || token.data.amount <= landlord.baseline) continue;
    const d = token.data.delegate;
    if (d.__option !== "Some" || d.value !== authority) continue;
    due.push({ landlord: row.pubkey, dividendAccount: landlord.dividendAccount });
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

/** Find the keeper's lookup table: from KEEPER_LOOKUP_TABLE, else the first one it owns. */
async function findLookupTable(k: Keeper): Promise<Address | null> {
  const fromEnv = process.env.KEEPER_LOOKUP_TABLE;
  if (fromEnv) return fromEnv as Address;
  type Row = { pubkey: Address };
  const rows = (await k.rpc
    .getProgramAccounts(ADDRESS_LOOKUP_TABLE_PROGRAM_ADDRESS, {
      encoding: "base64",
      dataSlice: { offset: 0, length: 0 },
      // Authority: an Option<Pubkey> whose tag is at byte 21 and key at 22.
      filters: [{ memcmp: { offset: BigInt(22), bytes: k.signer.address, encoding: "base58" } }],
    } as never)
    .send()) as unknown as Row[];
  return rows[0]?.pubkey ?? null;
}

/**
 * Make sure a lookup table holds every account the count reads, creating or
 * extending it as needed. Returns the table and its addresses once usable.
 */
async function ensureLookupTable(k: Keeper, needed: Address[]) {
  let table = await findLookupTable(k);
  const signatures: string[] = [];
  if (!table) {
    const slot = await k.rpc.getSlot({ commitment: "finalized" }).send();
    const create = await getCreateLookupTableInstructionAsync({ authority: k.signer, payer: k.signer, recentSlot: slot });
    signatures.push(await send(k, [create]));
    table = create.accounts[0].address as Address;
  }
  let current = await fetchMaybeAddressLookupTable(k.rpc, table);
  const have = new Set(current.exists ? current.data.addresses : []);
  const missing = needed.filter((a) => !have.has(a));
  for (let i = 0; i < missing.length; i += 20) {
    const extend = getExtendLookupTableInstruction({
      address: table,
      authority: k.signer,
      payer: k.signer,
      addresses: missing.slice(i, i + 20),
    });
    signatures.push(await send(k, [extend]));
  }
  if (missing.length > 0) {
    // New entries become usable one slot after they're added.
    await new Promise((r) => setTimeout(r, 1500));
    current = await fetchMaybeAddressLookupTable(k.rpc, table);
  }
  if (!current.exists) throw new Error("Lookup table not found after creation");
  return { table, addresses: current.data.addresses, signatures };
}

/**
 * Run the atomic count when it's due. The contract reads every landlord in one
 * transaction, so there's nothing to resume: if anyone else ran today's count,
 * this simply reports that and exits.
 */
export async function runCount(k: Keeper) {
  const config = await readConfig(k);
  const now = nowSecs();
  const last = Number(config.lastCountAt);
  if (now < Number(config.pausedUntil)) return { skipped: "paused" };
  if (last > 0 && now - last < COUNT_INTERVAL_SECS) {
    return { skipped: "counted recently", lastCountAt: last, nextCountAfter: last + COUNT_INTERVAL_SECS };
  }
  const roster = await fetchDecoded(k.rpc, await rosterPda(k.inst.program, k.inst.config), decodeRoster);
  if (!roster) throw new Error("Roster not found");

  const count = await countCommitmentIx(k.inst, roster);
  const needed = count.accounts?.map((a) => a.address) ?? [];
  const { table, addresses, signatures } = await ensureLookupTable(k, needed);
  signatures.push(
    await send(k, [count], { computeUnits: 200_000, lookupTables: { [table]: addresses } as Record<Address, Address[]> }),
  );
  const after = await readConfig(k);
  return {
    landlords: roster.entries.length,
    committedBps: after.lastCountBps,
    active: after.active,
    lookupTable: table,
    signatures,
  };
}

/** How long since the last count, for alerting on a stalled count. */
export async function countHealth(k: Keeper) {
  const config = await readConfig(k);
  const last = Number(config.lastCountAt);
  const age = last > 0 ? nowSecs() - last : null;
  return { lastCountAt: last, ageSecs: age, stale: age !== null && age > 2 * COUNT_INTERVAL_SECS };
}
