import type { Metadata } from "next";
import { CommitmentBar } from "@/components/CommitmentBar";
import { DelegatePanel } from "@/components/DelegatePanel";
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
            </ul>
          </div>
        </section>

        <section className="row">
          <h2 className="row-label">How counting works</h2>
          <div className="row-body">
            <ul className="plain-list">
              <li>
                <strong>A daily count</strong>
                <span>Once a day the contract reads every landlord&rsquo;s $PENIS in a single transaction.</span>
              </li>
              <li>
                <strong>Held, not borrowed</strong>
                <span>Each landlord counts for the lower of today&rsquo;s balance and the previous count&rsquo;s.</span>
              </li>
              <li>
                <strong>The threshold</strong>
                <span>Sweeps switch on at 30% of supply committed and pause below 25%.</span>
              </li>
              <li>
                <strong>Landlord places</strong>
                <span>
                  There are 28 places. When they&rsquo;re full, a newcomer holding more $PENIS takes the smallest
                  landlord&rsquo;s place.
                </span>
              </li>
            </ul>
          </div>
        </section>
      </div>
    </>
  );
}
