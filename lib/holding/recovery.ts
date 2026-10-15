import { historyArchive, payoutKey, timestamp, type Payout } from "./payout-history.ts";

export type RecoverySource = { name: string; value: { historyFloor?: unknown; rows?: unknown } };

/** Compare a rebuilt floored archive with the archive and unfinished scan it
 * replaces. Every old row at or after the floor must be present and unchanged;
 * rows below the floor are the cut transactions the rebuild drops. */
export function verifyRecovery(rebuilt: unknown, sources: RecoverySource[], expectedFloor: string) {
  const floor = new Date(timestamp(expectedFloor)).toISOString(), floorTime = timestamp(floor);
  const archive = historyArchive(rebuilt), problems: string[] = [];
  if (archive.historyFloor !== floor) problems.push(`rebuilt floor is ${archive.historyFloor ?? "missing"}, expected ${floor}`);
  if (archive.coverage.gap !== null) problems.push(`rebuilt archive has a gap: ${archive.coverage.gap.reason}`);
  const rebuiltRows = new Map(archive.rows.map((r) => [payoutKey(r), JSON.stringify(r)]));
  const checked: Record<string, { rows: number; atOrAfterFloor: number; missing: number; changed: number }> = {};
  for (const { name, value } of sources) {
    if (value?.historyFloor !== floor) problems.push(`${name} floor is ${String(value?.historyFloor ?? "missing")}, expected ${floor}`);
    if (!Array.isArray(value?.rows)) { problems.push(`${name} has no rows`); continue; }
    const rows = value.rows as Payout[], kept = rows.filter((r) => timestamp(r.createdAt) >= floorTime);
    let missing = 0, changed = 0;
    for (const r of kept) {
      const found = rebuiltRows.get(payoutKey(r));
      if (found === undefined) missing++;
      else if (found !== JSON.stringify({ signature: r.signature, holder: r.holder, assetMint: r.assetMint,
        amountRaw: r.amountRaw, createdAt: r.createdAt })) changed++;
    }
    if (missing || changed) problems.push(`${name}: ${missing} rows missing, ${changed} changed`);
    checked[name] = { rows: rows.length, atOrAfterFloor: kept.length, missing, changed };
  }
  return { ok: problems.length === 0, floor, rebuiltRows: archive.rows.length, fetchedAt: archive.fetchedAt, checked, problems };
}
