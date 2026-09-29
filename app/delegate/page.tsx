import type { Metadata } from "next";
import { DelegatePanel } from "@/components/DelegatePanel";
import { WalletProvider } from "@/components/WalletClient";

export const metadata: Metadata = {
  title: "Delegate",
  description: "Delegate your PUMP rewards to the $PENIS Endowment, or revoke at any time.",
};

export default function Delegate() {
  return (
    <>
      <section className="wrap">
        <div className="thesis-head">
          <h1 className="display h1">Delegate your rent.</h1>
          <p className="lede">
            One transaction lets the endowment collect the PUMP your $PENIS earns from now on. Your $PENIS, your SOL and
            the PUMP you already hold stay yours. Revoke at any time.
          </p>
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
                <span>A standard token approval on your PUMP account only. No other token is included.</span>
              </li>
              <li>
                <strong>A landlord record</strong>
                <span>
                  It notes the PUMP you already hold, so only new rewards are ever collected, and it tracks your
                  contribution.
                </span>
              </li>
              <li>
                <strong>A small deposit</strong>
                <span>About 0.002 SOL to store your landlord record on-chain.</span>
              </li>
            </ul>
          </div>
        </section>
      </div>
    </>
  );
}
