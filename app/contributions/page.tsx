import type { Metadata } from "next";
import Link from "next/link";
import { HoldingPanel } from "@/components/HoldingPanel";
import { WalletProvider } from "@/components/WalletClient";
export const metadata: Metadata = {
  title: "Pending contributions",
  description:
    "Review the proposed holding period and reclaim contributions before release.",
};
export default function Contributions() {
  return (
    <section className="wrap">
      <div className="thesis-head">
        <h1 className="display h1">Your pending contributions.</h1>
        <p className="lede">
          Each collection has its own holding timer. New deposits never become
          spendable because an older contribution was approved.
        </p>
      </div>
      <div className="row-body">
        <p>
          This draft proposes a minimum 24-hour hold, followed by receipt-level
          review. Only approved amounts may enter the spendable treasury.
          Incorrect amounts return to the original holder. At 72 hours,
          unreleased contributions become refund-only; a transaction is still
          needed to return them.
        </p>
        <p>
          You may reclaim a pending contribution at any time before its release
          transaction executes. Reclaiming also stops future collection until
          you opt in again. Once released, a contribution is permanent. PUMP’s
          external transfer controls could delay refunds if its issuer activates
          them.
        </p>
        <p>
          Your PENIS stays in your wallet. Collection starts at 30% committed,
          pauses below 25%, and ends at 200 million PENIS actually held by the
          endowment.
        </p>
        <p>
          <Link href="/delegate">
            Manage an earlier enrollment or token approval
          </Link>
        </p>
      </div>
      <WalletProvider>
        <HoldingPanel />
      </WalletProvider>
    </section>
  );
}
