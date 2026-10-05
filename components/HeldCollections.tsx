import type { Holding } from "@/lib/holding/wallet";
import type { Receipt } from "@/lib/holding/types";
import { formatTokens } from "@/lib/solana";

/** Recovery is rendered independently of the balances/enrollment dashboard. */
export function HeldCollections({ holding, error, busy, onRetry, onReclaim }: {
  holding: Holding | null;
  error: string | null;
  busy: boolean;
  onRetry: () => void;
  onReclaim: (receipt: Receipt) => void;
}) {
  if (error) return <p role="alert" className="small">
    {error} <button type="button" className="link-button" disabled={busy} onClick={onRetry}>Retry</button>
  </p>;
  if (!holding) return <p className="muted small">Checking held contributions…</p>;
  if (holding.receipts.length === 0) return <p className="muted small">No pending contributions found.</p>;
  const held = holding.receipts.reduce((sum, r) => sum + r.amount, 0n);
  const when = (t: bigint) => new Date(Number(t) * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  return <>
    <p><strong>Being held: {formatTokens(held)} PUMP</strong></p>
    <p className="muted small">
      Every collection is held for at least 24 hours. You can take any pending contribution back until it is released,
      including after 24 hours. Taking back a contribution from your current pledge also stops collection until you opt in again.
    </p>
    <div className="table-scroll">
      <table className="table">
        <thead><tr><th>Collected</th><th className="num">PUMP</th><th>Earliest release</th><th aria-label="Reclaim" /></tr></thead>
        <tbody>{holding.receipts.map(r => <tr key={r.nonce.toString()} className="current">
          <td>{when(r.collected_at)}</td><td className="num">{formatTokens(r.amount)}</td><td>{when(r.release_at)}</td>
          <td className="num"><button type="button" className="link-button" disabled={busy} onClick={() => onReclaim(r)}>
            Take it back
          </button></td>
        </tr>)}</tbody>
      </table>
    </div>
  </>;
}
