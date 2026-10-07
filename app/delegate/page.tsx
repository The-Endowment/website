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
            Pledge the PUMP rewards your $PENIS earns. Your $PENIS stays in your wallet. Every
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
              The $PENIS in the wallet you pledge counts toward the 30%, and the PUMP it earns goes to the endowment.
              The contract limits collections using posted reward totals, and the collector checks payout history to
              exclude purchases and other coins&rsquo; rewards. Want to pledge part of your holdings? Keep
              the rest in another wallet.
            </p>
            <p>
              Every collection then waits at least 24 hours while a second, independent reviewer checks it against the
              payout records. If a collection ever includes PUMP that wasn&rsquo;t a reward (say you spent your rewards
              and bought PUMP just before it), the reviewer can return it, and you can take it back yourself any time until
              it&rsquo;s released. These checks can make mistakes; after release, the contract cannot refund that collection.
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
                  An unlimited token approval on your PUMP account only, shown in your wallet. The contract decides what
                  it can collect using a reward allowance and your protected starting balance. Your
                  $PENIS and other tokens aren&rsquo;t included.
                </span>
              </li>
              <li>
                <strong>A landlord record</strong>
                <span>
                  It records a protected baseline equal to your PUMP balance when you join and tracks your net contribution. If you
                  leave and come back later, it resets to your balance at that moment.
                </span>
              </li>
              <li>
                <strong>The collection switch</strong>
                <span>
                  Your signature enables collection permission. Stopping collection or reclaiming a receipt from your
                  current pledge disables it; reclaiming an older pledge&rsquo;s receipt does not disable a newer pledge.
                  Re-enabling needs your signature and a new count.
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
                <strong>During the test period</strong>
                <span>
                  While upgrade authority exists, the program and its protections can change. Removing that authority
                  requires a separate decision after testing and review; operator replacement and emergency controls
                  remain separate administrative powers. Leave at any time.
                </span>
              </li>
            </ul>
          </div>
        </section>

        <section id="counting" className="row">
          <h2 className="row-label">How counting works</h2>
          <div className="row-body">
            <p>
              Once a day the contract counts every landlord&rsquo;s $PENIS. Public participation activates at 30% of supply
              committed and deactivates below 25%. Collection also requires current counts, safety checks and running
              services. Your $PENIS counts from your second count, and every
              landlord&rsquo;s record is public on-chain.
            </p>
            <details className="count-details">
              <summary>How the count resists gaming</summary>
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
                <span>Public participation activates at 30% of supply committed and deactivates below 25%. A founders test uses a separate, visibly identified mode.</span>
              </li>
              <li>
                <strong>Checked between counts</strong>
                <span>
                  Several times a day, at unannounced times, the endowment&rsquo;s refresher reads every landlord. A
                  wallet counts after three of these checks since its last count, each finding it still delegated, and
                  only for the lowest balance any of them saw, so $PENIS moved between wallets is very hard to count
                  twice. Every check is public on-chain.
                </span>
              </li>
              <li>
                <strong>Public tally</strong>
                <span>Every landlord&rsquo;s record is on-chain for anyone to check.</span>
              </li>
            </ul>
            </details>
          </div>
        </section>

      </div>
    </>
  );
}
