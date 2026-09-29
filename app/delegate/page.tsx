import type { Metadata } from "next";
import { CommitmentBar } from "@/components/CommitmentBar";
import { DelegatePanel } from "@/components/DelegatePanel";
import { LandlordLedger } from "@/components/LandlordLedger";
import { WalletProvider } from "@/components/WalletClient";

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
            One transaction lets the endowment collect the new PUMP that arrives in your PUMP account from now on. Your
            $PENIS, your SOL and the PUMP you hold when you join stay yours. Leave at any time.
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
              Everything in the wallet you delegate is committed: its $PENIS counts toward the 30%, and all new PUMP that
              arrives in it goes to the endowment. Want to commit part of your holdings? Keep the rest in another wallet.
            </p>
            <p className="muted small">
              We recommend a wallet that holds only the $PENIS you&rsquo;re committing and no other PUMP, so everything
              that arrives there is your $PENIS rent.
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
                <strong>A small deposit</strong>
                <span>About 0.003 SOL to store your landlord record on-chain, returned when you leave.</span>
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

        <section className="row">
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
                <span>Sweeps switch on at 30% of supply committed and pause below 25%.</span>
              </li>
              <li>
                <strong>Checked between counts</strong>
                <span>
                  Between counts the endowment&rsquo;s refresher reads every landlord at unannounced times. A wallet counts
                  only if it was read, still delegated, since its last count, so the same $PENIS can&rsquo;t be counted in
                  two wallets.
                </span>
              </li>
              <li>
                <strong>Public tally</strong>
                <span>Every landlord&rsquo;s record is on-chain for anyone to check.</span>
              </li>
            </ul>
          </div>
        </section>

        <LandlordLedger />
      </div>
    </>
  );
}
