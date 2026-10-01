import Link from "next/link";
import type { Metadata } from "next";
import { CommitmentBar } from "@/components/CommitmentBar";
import { DelegatePanel } from "@/components/DelegatePanel";
import { WalletProvider } from "@/components/WalletClient";
import { COLLECTION_PENDING_NOTICE } from "@/lib/collection-policy";

export const metadata: Metadata = {
  title: "Enrollment",
  description: "Review an existing endowment enrollment or leave. New enrollment is closed while reported reward collection is reviewed.",
};

export default function Delegate() {
  return (
    <>
      <section className="wrap">
        <div className="thesis-head">
          <h1 className="display h1">Manage your enrollment.</h1>
          <p className="lede">{COLLECTION_PENDING_NOTICE} Existing participants can still revoke and leave.</p>
          <p><Link href="/contributions">View the refundable collection proposal and pending contributions</Link></p>
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
              The refundable collection draft disables the old balance-based sweep and requires fresh consent.
              Old deployments and approvals are not automatically changed by this website update.
              Existing participants can revoke their approval and leave at any time.
            </p>
            <p>
              Leave revokes this endowment&rsquo;s PUMP approval and removes its enrollment record.
              You can also revoke the token approval directly through your wallet; this stops further delegated collection.
              Released contributions are permanent; pending contributions in the new holding system can be reclaimed.
            </p>
          </div>
        </section>
        <section className="row">
          <h2 className="row-label">Planned pledge</h2>
          <div className="row-body">
            <p>
              The current proposal uses a collector and independent reviewer to identify PENIS rewards paid in PUMP.
              Each contribution is held for at least 24 hours and remains reclaimable before release.
              Purchased PUMP and other coins&apos; rewards are excluded by the worker policy, which depends on trusted evidence.
            </p>
            <p>
              Your $PENIS will stay in your wallet. Funding starts at 30% committed, pauses below 25%, and resumes at 30%.
              Holder contributions end permanently when the endowment directly holds 200 million $PENIS.
              The local replacement is under review; collection remains disabled here until an authorized release.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
