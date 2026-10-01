import type { Metadata } from "next";
import { CommitmentBar } from "@/components/CommitmentBar";
import { DelegatePanel } from "@/components/DelegatePanel";
import { WalletProvider } from "@/components/WalletClient";
import { COLLECTION_PENDING_NOTICE } from "@/lib/collection-policy";

export const metadata: Metadata = {
  title: "Enrollment",
  description: "Review an existing endowment enrollment or leave. New enrollment is closed while reward routing is reviewed.",
};

export default function Delegate() {
  return (
    <>
      <section className="wrap">
        <div className="thesis-head">
          <h1 className="display h1">Manage your enrollment.</h1>
          <p className="lede">{COLLECTION_PENDING_NOTICE} Existing participants can still revoke and leave.</p>
          <CommitmentBar />
        </div>
      </section>
      <div className="wrap">
        <section className="row">
          <h2 className="row-label">Your wallet</h2>
          <WalletProvider><DelegatePanel /></WalletProvider>
        </section>
        <section className="row">
          <h2 className="row-label">Existing approvals</h2>
          <div className="row-body">
            <p>
              Closing enrollment and stopping this website&rsquo;s automated collector does not revoke existing approvals.
              The old contract can still collect PUMP above its recorded balance baseline, including purchased PUMP,
              if someone else calls it. Existing participants should revoke that approval before relying on reward-only protection.
            </p>
            <p>
              Leave revokes this endowment&rsquo;s PUMP approval and removes its enrollment record.
              You can also revoke the token approval directly through your wallet; this stops further delegated collection.
              Previously completed contributions are not refunded.
            </p>
          </div>
        </section>
        <section className="row">
          <h2 className="row-label">Planned pledge</h2>
          <div className="row-body">
            <p>
              The planned system will contribute verified StonkFun rewards paid in PUMP, including rewards from other
              coins in the same wallet, while you are enrolled and funding is active. Existing PUMP, purchased PUMP,
              ordinary transfers and rewards already paid while funding is inactive must stay with you.
            </p>
            <p>
              Your $PENIS will stay in your wallet. Funding starts at 30% committed, pauses below 25%, and resumes at 30%.
              Holder contributions end permanently when the endowment directly holds 200 million $PENIS.
              These are requirements for the replacement; reward-only collection is not available in the current contract.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
