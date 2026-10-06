import type { Metadata } from "next";
import { CommitmentBar } from "@/components/CommitmentBar";
import { DelegatePanel } from "@/components/DelegatePanel";
import { WalletProvider } from "@/components/WalletClient";
import { DELEGATION_CLOSED_NOTE, DELEGATION_OPEN } from "@/lib/site";

export const metadata: Metadata = {
  title: "Delegate",
  description: "Delegate your PUMP rewards to the $PENIS Endowment, or leave at any time.",
};

export default function Delegate() {
  return (
    <>
      <section className="wrap">
        <div className="thesis-head">
          <h1 className="display h1">Delegate your rent.</h1>
          <p className="lede">
            Pledge 100% of eligible PUMP rewards from your $PENIS. Your $PENIS stays in your wallet. Every
            collection is held for at least 24 hours, and you can take it back until it&rsquo;s released. Stop at any
            time. {DELEGATION_OPEN ? "" : DELEGATION_CLOSED_NOTE}
          </p>
          <CommitmentBar />
        </div>
      </section>

      <div className="wrap">
        <section className="row">
          <h2 className="row-label">Your wallet</h2>
          <WalletProvider>
            <DelegatePanel />
          </WalletProvider>
        </section>

        <section className="row">
          <h2 className="row-label">Your wallet is the commitment</h2>
          <div className="row-body">
            <p>
              Eligible $PENIS in your pledged wallet counts toward the 30% participation threshold. The collector checks
              PENIS payout records and wallet history to identify its PUMP rewards. Existing PUMP, purchases and rewards
              from other coins are excluded from the pledge. Want to pledge part of your holdings? Keep the rest in another wallet.
            </p>
            <p>
              The contract limits collection using posted reward totals and counted holdings. That allowance limits the
              amount; identifying eligible rewards also relies on off-chain data and services. Mistakes are possible:
              spending rewards and buying PUMP just before collection can cause purchased PUMP to be collected temporarily.
            </p>
            <p>
              Every collection waits at least 24 hours. A separate reviewer checks the payout records and wallet history
              before approving release and can return incorrect amounts. You can take back any pending contribution
              yourself until it is released, including after 24 hours.
            </p>
            <p className="muted small">
              We recommend a wallet that holds just the $PENIS you&rsquo;re committing, so your records stay simple.
            </p>
          </div>
        </section>

        <section className="row">
          <h2 className="row-label">What you sign</h2>
          <div className="row-body">
            <ul className="plain-list">
              <li>
                <strong>A delegation</strong>
                <span>
                  An unlimited token approval on your PUMP account. The contract&rsquo;s rules restrict its use; the approval
                  amount itself does not restrict transfers to dividends. Your $PENIS and other tokens are not approved.
                </span>
              </li>
              <li>
                <strong>A landlord record</strong>
                <span>
                  It records your PUMP balance when you join as a protected baseline and tracks contributions. Rejoining
                  resets that baseline to the account&rsquo;s balance at that moment. Payout verification and review add further checks.
                </span>
              </li>
              <li>
                <strong>The collection switch</strong>
                <span>
                  Your signature enables collection. Stopping collection or reclaiming a contribution from your current
                  pledge disables it. Reclaiming an older pledge&rsquo;s contribution leaves a newer pledge unchanged.
                  Re-enabling requires your signature and open enrollment.
                </span>
              </li>
              <li>
                <strong>A small deposit</strong>
                <span>
                  About 0.005 SOL to store your records on-chain. The landlord record&rsquo;s share is returned when you
                  leave.
                </span>
              </li>
              <li>
                <strong>Who can change the rules</strong>
                <span>
                  A retained upgrade authority can change the contract, including collection and refund protections.
                  The deployed program, authorities and operators must be disclosed before pledging opens. Key custody
                  and any plan to remove authority still need agreement; removing the admin alone leaves other roles in place.
                </span>
              </li>
            </ul>
          </div>
        </section>

        <section id="counting" className="row">
          <h2 className="row-label">How counting works</h2>
          <div className="row-body">
            <ul className="plain-list">
              <li>
                <strong>A daily count</strong>
                <span>Once a day the contract reads every landlord&rsquo;s $PENIS. There&rsquo;s no limit on landlords.</span>
              </li>
              <li>
                <strong>Held, not borrowed</strong>
                <span>
                  Each landlord counts for the lower of today&rsquo;s balance and the previous count&rsquo;s, so new or
                  added $PENIS counts from the following count, and your first count only records your balance.
                </span>
              </li>
              <li>
                <strong>The threshold</strong>
                <span>Participation activates at 30% of supply committed and pauses below 25%. Collection also requires consent and the other safety checks.</span>
              </li>
              <li>
                <strong>Checked between counts</strong>
                <span>
                  Several times a day, at unannounced times, the endowment&rsquo;s refresher reads landlords in batches. A
                  wallet counts after three of these checks since its last count, each finding it still delegated, and
                  only for the lowest balance any of them saw. This reduces double counting when $PENIS moves between
                  wallets, but depends on the refresher&rsquo;s timing. Every check is public on-chain.
                </span>
              </li>
              <li>
                <strong>Public tally</strong>
                <span>Every landlord&rsquo;s record is on-chain for anyone to check.</span>
              </li>
            </ul>
          </div>
        </section>

      </div>
    </>
  );
}
