import { createSolanaRpc, type Address } from "@solana/kit";
import {
  decodeConfig,
  fetchDecoded,
  landlordCountedFromLogs,
  listLandlords,
  type LandlordCountedEvent,
} from "@/lib/endowment";
import { flagshipInstance, RPC_URL } from "@/lib/solana";

export type LedgerRow = {
  owner: Address;
  /** What the landlord counted for in the last finished count. */
  counted: string;
  /** Its $PENIS balance when that count read it. */
  balanceAtCount: string;
  /** Set when its balance moved in step with another landlord's between counts. */
  flag: string | null;
};

export type Ledger =
  | { launched: false }
  | { launched: true; round: number; totalCounted: string; supply: string; rows: LedgerRow[] };

/**
 * Pairs of landlords whose balances moved by about the same amount in opposite
 * directions between the last two counts: one went up while another went down.
 * A neutral signal for readers, not a verdict.
 */
function movedBetweenLandlords(prev: Map<Address, bigint>, last: Map<Address, bigint>, minMove: bigint) {
  const ups: [Address, bigint][] = [];
  const downs: [Address, bigint][] = [];
  for (const [owner, now] of last) {
    const before = prev.get(owner);
    if (before === undefined) continue;
    const d = now - before;
    if (d >= minMove) ups.push([owner, d]);
    if (-d >= minMove) downs.push([owner, -d]);
  }
  const flagged = new Set<Address>();
  for (const [up, gained] of ups) {
    for (const [down, lost] of downs) {
      const larger = gained > lost ? gained : lost;
      const diff = gained > lost ? gained - lost : lost - gained;
      // Within 5%, allowing for the transfer fee.
      if (diff * BigInt(20) <= larger) {
        flagged.add(up);
        flagged.add(down);
      }
    }
  }
  return flagged;
}

/** The latest finished count, landlord by landlord, from on-chain accounts and events. */
export async function loadLedger(): Promise<Ledger> {
  const inst = await flagshipInstance();
  if (!inst) return { launched: false };
  const rpc = createSolanaRpc(process.env.SOLANA_RPC_URL ?? RPC_URL);
  const config = await fetchDecoded(rpc, inst.config, decodeConfig);
  if (!config) return { launched: false };

  const lastRound = config.count.open ? config.count.round - BigInt(1) : config.count.round;
  const landlords = await listLandlords(rpc, inst.program, inst.config);

  // Balances read in each of the last two finished rounds, from LandlordCounted events.
  const byRound = new Map<bigint, Map<Address, bigint>>();
  try {
    const sigs = await rpc.getSignaturesForAddress(inst.config, { limit: 80 }).send();
    for (const s of sigs) {
      if (s.err) continue;
      const tx = await rpc
        .getTransaction(s.signature, { maxSupportedTransactionVersion: 0, encoding: "json" })
        .send();
      const logs = tx?.meta?.logMessages ?? [];
      for (const e of landlordCountedFromLogs(logs, inst.config) as LandlordCountedEvent[]) {
        if (e.round !== lastRound && e.round !== lastRound - BigInt(1)) continue;
        const round = byRound.get(e.round) ?? new Map<Address, bigint>();
        round.set(e.owner, e.rawBalance);
        byRound.set(e.round, round);
      }
    }
  } catch {
    // Flags are a bonus; the tally below comes from accounts.
  }
  const minMove = (config.count.supply * BigInt(config.params.minStakeBps || 10)) / BigInt(10_000);
  const flagged = movedBetweenLandlords(
    byRound.get(lastRound - BigInt(1)) ?? new Map(),
    byRound.get(lastRound) ?? new Map(),
    minMove > BigInt(0) ? minMove : BigInt(1),
  );

  const rows = landlords
    .map(({ record }) => ({
      owner: record.owner,
      countedRaw: record.countedRound === lastRound ? record.countedAmount : BigInt(0),
      balanceRaw: record.countedRound === lastRound ? record.snapshot : BigInt(0),
    }))
    .sort((a, b) => (b.countedRaw > a.countedRaw ? 1 : b.countedRaw < a.countedRaw ? -1 : 0))
    .map((r) => ({
      owner: r.owner,
      counted: r.countedRaw.toString(),
      balanceAtCount: r.balanceRaw.toString(),
      flag: flagged.has(r.owner) ? "moved between landlord wallets" : null,
    }));

  return {
    launched: true,
    round: Number(lastRound),
    totalCounted: config.lastCommitted.toString(),
    supply: config.count.supply.toString(),
    rows,
  };
}
