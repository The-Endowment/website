import type { Metadata } from "next";
import { links } from "@/lib/site";

export const metadata: Metadata = {
  title: "For projects",
  description:
    "Explore the endowment's open-source design and historical guides. The version 4 replacement is under local review and is not ready for project launches.",
};

export default function Build() {
  return (
    <>
      <section className="wrap">
        <div className="thesis-head">
          <h1 className="display h1">Your coin, your endowment.</h1>
          <p className="lede">
            The endowment explores how holders can contribute dividend income to a shared treasury. The version 4
            replacement is being developed and reviewed locally for $PENIS. New enrollment and collection remain
            closed here; a reviewed shared deployment for other projects is not available through this site.
          </p>
          <div className="actions">
            <a href="/endowment-guide.pdf" className="button button-primary" download>
              Historical guide (PDF)
            </a>
            <a href="/endowment-guide.md" className="button" download>
              Historical guide (Markdown)
            </a>
          </div>
        </div>
      </section>

      <div className="wrap">
        <section className="row">
          <h2 className="row-label">For future projects</h2>
          <div className="row-body">
            <div className="options">
              <div className="option">
                <h3>Shared deployment needs further review</h3>
                <p className="muted">
                  The source includes a multi-endowment design, but the current replacement focuses on the $PENIS
                  campaign. Supporting another project requires verifying its tokens, pool, reward sources and
                  treasury eligibility, then reviewing the full deployment.
                </p>
                <ul>
                  <li>Compatible tokens and a supported liquidity pool</li>
                  <li>Verifiable reward receipts and a reviewed reporting service</li>
                  <li>An explicit policy for admin, reporter and program upgrade authorities</li>
                </ul>
                <p className="note">
                  No launch date or removal of upgrade authority is promised. Retained upgrade authority can replace
                  the contract and override its safeguards.
                </p>
              </div>
              <div className="option">
                <h3>Explore the source</h3>
                <p className="muted">
                  The contract, website and keeper are open source. The linked repository contains published code;
                  the local version 4 replacement is still being prepared for review. Reading or copying the source
                  does not establish that it is ready to hold funds.
                </p>
                <ul>
                  <li>Source and tests are available on GitHub</li>
                  <li>The linked guides describe the legacy system, not version 4 deployment instructions</li>
                  <li>Independent security review and deployment validation remain necessary before launch</li>
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
          <h2 className="row-label">Current design and limits</h2>
          <div className="row-body">
            <ul className="plain-list">
              <li>
                <strong>Restricted treasury use</strong>
                <span>
                  The replacement has no admin or reporter withdrawal instruction. Buybacks can move treasury coins
                  into permanently locked liquidity; they do not all remain in the direct vault.
                </span>
              </li>
              <li>
                <strong>A trusted reward reporter</strong>
                <span>
                  The $PENIS pledge covers all verified StonkFun rewards paid in PUMP while enrolled and funding is
                  active, including rewards from other coins. There is no daily wallet cap. Broad PUMP approval is
                  revocable, but an incorrect report can collect PUMP outside the intended reward policy.
                </span>
              </li>
              <li>
                <strong>Bounded operations</strong>
                <span>
                  Commitment thresholds, treasury inventory limits, price checks and token-setting checks constrain
                  operations. They do not guarantee correct reward classification, fair prices or protection from all losses.
                </span>
              </li>
              <li>
                <strong>Launch requirements still open</strong>
                <span>
                  Program-owned treasury reward eligibility, independent security review and upgrade governance
                  remain outstanding. See the <a href="/security">security and review status</a> before relying on
                  the design or historical guides.
                </span>
              </li>
            </ul>
          </div>
        </section>
      </div>
    </>
  );
}
