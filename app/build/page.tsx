import type { Metadata } from "next";
import { links } from "@/lib/site";

export const metadata: Metadata = {
  title: "For projects",
  description:
    "Start an endowment for your own dividend-paying coin: on the shared open-source contract, or as your own deployment.",
};

export default function Build() {
  return (
    <>
      <section className="wrap">
        <div className="thesis-head">
          <h1 className="display h1">Your coin, your endowment.</h1>
          <p className="lede">
            If your coin pays its holders dividends, your largest holders can turn that income into a permanent,
            never-selling holder of your coin. The same contract that runs the $PENIS Endowment is open source and
            built to host many projects.
          </p>
          <div className="actions">
            <a href="/endowment-guide.pdf" className="button button-primary" download>
              Download the guide (PDF)
            </a>
            <a href="/endowment-guide.md" className="button" download>
              Guide (Markdown)
            </a>
          </div>
        </div>
      </section>

      <div className="wrap">
        <section className="row">
          <h2 className="row-label">Two ways</h2>
          <div className="row-body">
            <div className="options">
              <div className="option">
                <h3>Create an endowment on the shared contract</h3>
                <p className="muted">
                  One transaction creates your endowment on the same reviewed contract as $PENIS. Your endowment has its
                  own vault, landlords and settings, fully separate from every other project.
                </p>
                <ul>
                  <li>A Raydium CPMM pool pairing your coin with its dividend asset</li>
                  <li>Dividends pushed to holders&rsquo; wallets automatically, with no claim step</li>
                  <li>Optional: donate 0.1%, 0.2% or 0.3% of each buy to the $PENIS Endowment, for PUMP-paid coins</li>
                </ul>
                <p className="note">
                  Creation opens once the contract&rsquo;s upgrade key has been destroyed, so every project runs on
                  code that can never change.
                </p>
              </div>
              <div className="option">
                <h3>Deploy your own copy</h3>
                <p className="muted">
                  Prefer to run it yourself? The contract, website and keeper are Apache-2.0 licensed. Fork them, adapt
                  them, and deploy under your own keys.
                </p>
                <ul>
                  <li>Full source on GitHub, with tests against real mainnet pool data</li>
                  <li>The guide covers building, deploying and running the keeper</li>
                  <li>You run your own review before launch</li>
                </ul>
                <div className="actions">
                  <a href={links.github} className="button">
                    Source on GitHub
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="row">
          <h2 className="row-label">What every endowment gets</h2>
          <div className="row-body">
            <ul className="plain-list">
              <li>
                <strong>A vault that never sells</strong>
                <span>No function can move your coin out of the endowment.</span>
              </li>
              <li>
                <strong>A real commitment threshold</strong>
                <span>Sweeps start only once landlords holding your chosen share of supply are in, counted daily on-chain.</span>
              </li>
              <li>
                <strong>Careful buying</strong>
                <span>Small buys, sized to pool depth and priced against a time-weighted average.</span>
              </li>
              <li>
                <strong>A public trail</strong>
                <span>Every sweep, buy and setting change is an on-chain event anyone can follow.</span>
              </li>
            </ul>
          </div>
        </section>
      </div>
    </>
  );
}
