import type { Address } from "@solana/kit";
import type { Receipt } from "@/lib/holding/types";
const amount = (n: bigint) =>
  `${n / 1000000n}.${(n % 1000000n).toString().padStart(6, "0")}`;
const date = (n: bigint) => new Date(Number(n) * 1000).toLocaleString();
export function HoldingReceipts({
  rows,
  busy,
  reclaim,
}: {
  rows: { address: Address; receipt: Receipt }[];
  busy: boolean;
  reclaim: (address: Address) => void;
}) {
  return rows.map(({ address, receipt }) => (
    <article key={address} className="row-body">
      <p>
        <strong>{amount(receipt.amount)} PUMP</strong> · receipt{" "}
        {receipt.nonce.toString()}
      </p>
      <p>
        Collected: {date(receipt.collected_at)}
        <br />
        Earliest release, after approval: {date(receipt.release_at)}
        <br />
        Release expires: {date(receipt.refund_at)}
      </p>
      <p>
        {receipt.reviewed
          ? `${amount(receipt.approved_amount)} PUMP approved; still reclaimable until release.`
          : "Awaiting review. The holding timer alone does not authorize spending."}
      </p>
      <button
        className="button"
        disabled={busy}
        onClick={() => reclaim(address)}
      >
        Reclaim this contribution
      </button>
    </article>
  ));
}
