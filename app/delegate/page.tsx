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
            One signature pledges the PUMP your $PENIS earns, and never more. Your $PENIS stays in your wallet. Every
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
              The contract caps every collection at what that $PENIS earned, and the collector checks each payout first,
              so PUMP you held, bought or earned from other coins stays yours. Want to pledge part of your holdings? Keep
              the rest in another wallet.
            </p>
            <p>
              Every collection then waits at least 24 hours while a second, independent reviewer checks it against the
              payout records. If a collection ever includes PUMP that wasn&rsquo;t a reward (say you spent your rewards
              and bought PUMP just before it), the reviewer returns it, and you can take it back yourself any time until
              it&rsquo;s released.
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
                  it can collect: never more than your $PENIS earned, and never the PUMP you held when you joined. Your
                  $PENIS and other tokens aren&rsquo;t included.
                </span>
              </li>
              <li>
                <strong>A landlord record</strong>
                <span>
                  It notes the PUMP you hold when you join, which always stays yours, and tracks your contribution. If you
                  leave and come back later, it resets to your balance at that moment.
                </span>
              </li>
              <li>
                <strong>The collection switch</strong>
                <span>
                  Your signature turns collection on. Stopping collection, or taking back a collection, switches it off,
                  and one more signature switches it back on.
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
                  During the founders&rsquo; test the program can still be upgraded, and every upgrade is announced
                  first. The plan is to then destroy the upgrade key. Leave at any time.
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
                <span>Collection switches on at 30% of supply committed and stays on unless it falls below 25%.</span>
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
          </div>
        </section>

      </div>
    </>
  );
}
