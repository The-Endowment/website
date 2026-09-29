import { type Address } from "@solana/kit";
import { attestationsOf, decodeConfig, fetchDecoded, listLandlords, REQUIRED_ATTESTATIONS } from "@/lib/endowment";
import { flagshipInstance, readRpc } from "@/lib/solana";

export type LedgerRow = {
  owner: Address;
  /** The count this landlord was last read in, and what it counted for then. */
  round: number;
  counted: string;
  /** Its recorded $PENIS: the most its next count can credit (lowered by any refresh since). */
  recorded: string;
  /** Checks by the endowment's refresher since its last count; it counts once this reaches `required`. */
  checks: number;
  required: number;
};

export type Ledger =
  | { launched: false }
  | {
      launched: true;
      /** The last finished count and its total. */
      round: number;
      totalCounted: string;
      committedBps: number;
      /** A count in progress, if one is open. */
      inProgress: { round: number; counted: number; expected: number } | null;
      rows: LedgerRow[];
    };

/**
 * Every landlord's record, straight from the landlord accounts, which are the
 * authoritative source (events are a convenience, and logs can be truncated).
 * Read through the public RPC, never the keeper's.
 */
export async function loadLedger(): Promise<Ledger> {
  const inst = await flagshipInstance();
  if (!inst) return { launched: false };
  const rpc = readRpc();
  const config = await fetchDecoded(rpc, inst.config, decodeConfig);
  if (!config) return { launched: false };

  const lastRound = config.count.open ? config.count.round - BigInt(1) : config.count.round;
  const landlords = await listLandlords(rpc, inst.program, inst.config);
  const rows = landlords
    .map(({ record }) => ({
      owner: record.owner,
      round: Number(record.countedRound),
      countedRaw: record.countedAmount,
      recorded: (record.snapshotValid ? record.snapshot : BigInt(0)).toString(),
      checks: Math.min(attestationsOf(config, record), REQUIRED_ATTESTATIONS),
      required: REQUIRED_ATTESTATIONS,
    }))
    .sort((a, b) => (b.countedRaw > a.countedRaw ? 1 : b.countedRaw < a.countedRaw ? -1 : 0))
    .map(({ countedRaw, ...r }) => ({ ...r, counted: countedRaw.toString() }));

  return {
    launched: true,
    round: Number(lastRound),
    totalCounted: config.lastCommitted.toString(),
    committedBps: config.lastCountBps,
    inProgress: config.count.open
      ? { round: Number(config.count.round), counted: config.count.counted, expected: config.count.expected }
      : null,
    rows,
  };
}
