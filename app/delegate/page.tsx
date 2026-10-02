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
            One transaction lets the endowment collect the PUMP your $PENIS earns, and never more. Every collection is
            held for 24 hours, and you can take it back in that time. Your $PENIS, your SOL and the PUMP you hold when
            you join stay yours. Leave at any time. {DELEGATION_OPEN ? "" : DELEGATION_CLOSED_NOTE}
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
              The $PENIS in the wallet you delegate counts toward the 30%, and the PUMP it earns goes to the endowment.
              Each day the contract works out what that $PENIS earned and collects at most that, so PUMP you buy or earn
              from other coins stays yours. Want to commit part of your holdings? Keep the rest in another wallet.
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
                  A standard token approval on your PUMP account only, shown in your wallet with the token and amount. No
                  other token is included.
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
                  A second small record that says collection is on for your wallet. Taking a collection back switches it
                  off, and one click switches it on again.
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
                  The contract&rsquo;s upgrade key is held by the team&rsquo;s multisig until it is destroyed at the end of
                  the public test period, and every upgrade is announced first. Leave at any time.
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
                <span>Collection switches on at 30% of supply committed and pauses below 25%.</span>
              </li>
              <li>
                <strong>Checked between counts</strong>
                <span>
                  Several times a day, at unannounced times, the endowment&rsquo;s refresher reads every landlord at once. A
                  wallet counts after three of these checks since its last count, each finding it still delegated, and
                  only for the lowest balance any of them saw. $PENIS moved between wallets counts once, and every check
                  is public on-chain.
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
