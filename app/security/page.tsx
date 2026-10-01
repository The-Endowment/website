import type { Metadata } from "next";
import Link from "next/link";
import { links } from "@/lib/site";
export const metadata: Metadata = {
  title: "Security",
  description:
    "Refundable collection safeguards, trust assumptions and remaining launch requirements.",
};
const legacyCommit = "3bfce2c4aa4e8e560a94c749ebf273c3b53a7d58";
export default function Security() {
  return (
    <>
      <section className="wrap">
        <div className="thesis-head">
          <h1 className="display h1">Safeguards, trust and review.</h1>
          <p className="lede">
            The refundable collection system is a draft. New enrollment and
            automated collection remain closed. It has automated tests, but has
            not received an independent security audit and is not an authorized
            production release.
          </p>
          <div className="actions">
            <Link href="/contributions" className="button">
              Pending contributions
            </Link>
            <a href={links.github} className="button">
              Source code
            </a>
          </div>
        </div>
      </section>
      <div className="wrap">
        <section className="row">
          <h2 className="row-label">Collection and review</h2>
          <div className="row-body">
            <ul className="plain-list">
              <li>
                <strong>Proposed pledge</strong>
                <span>
                  Verified PENIS rewards paid in PUMP after consent while
                  funding is active. Existing PUMP, purchases, ordinary
                  transfers, other coins’ rewards, and inactive-period rewards
                  do not create eligibility under this worker policy.
                </span>
              </li>
              <li>
                <strong>Trusted services</strong>
                <span>
                  A collector identifies eligible rewards; a distinct reviewer
                  checks finalized payout and spending history independently.
                  The contract checks signatures, balances, consent, amounts and
                  replay protection. It cannot prove the origin of fungible PUMP
                  or authenticate an API response.
                </span>
              </li>
              <li>
                <strong>Mistakes remain possible</strong>
                <span>
                  The wallet grants a broad, revocable PUMP token approval. A
                  faulty collector can temporarily collect ineligible PUMP
                  within contract limits. Honest review or holder reclaim
                  provides a recovery path. Compromised services, shared
                  evidence failures, or program upgrades can defeat these
                  safeguards.
                </span>
              </li>
              <li>
                <strong>Estimates are diagnostics</strong>
                <span>
                  Daily aggregate API deltas, volume estimates and midnight
                  balance checkpoints can flag discrepancies. Matching totals
                  cannot prove that each wallet was charged correctly. The
                  retained optional allowance is an estimate, not proof of
                  reward ownership.
                </span>
              </li>
            </ul>
          </div>
        </section>
        <section className="row">
          <h2 className="row-label">Holding and refunds</h2>
          <div className="row-body">
            <ul className="plain-list">
              <li>
                <strong>Separate custody</strong>
                <span>
                  Holder collections enter a holding account that buybacks
                  cannot spend. Each collection records its owner, amount and
                  collection time, with its own 24-hour minimum hold. New
                  deposits do not inherit an older deposit’s approval.
                </span>
              </li>
              <li>
                <strong>Approval and expiry</strong>
                <span>
                  Only reviewed amounts can reach the spendable treasury after
                  the hold. A partial approval returns the excess to the
                  original holder. At 72 hours, unreleased contributions become
                  refund-only. A keeper or another caller must still submit a
                  transaction; time passing does not move tokens.
                </span>
              </li>
              <li>
                <strong>Holder reclaim</strong>
                <span>
                  You can reclaim a pending contribution before release, even if
                  already approved. The first transaction to execute determines
                  the outcome. A refund disables further collection until you
                  consent again; that protection survives leaving and
                  re-enrollment. Released contributions are permanent.
                </span>
              </li>
              <li>
                <strong>Independent exit</strong>
                <span>
                  Revoking the token delegation stops new collection without the
                  keeper or this site. Disabling consent also cancels pending
                  release. Refunds remain available during a program pause or
                  retirement and after the original token account closes,
                  subject to the token program’s transfer controls.
                </span>
              </li>
            </ul>
          </div>
        </section>
        <section className="row">
          <h2 className="row-label">Treasury safeguards</h2>
          <div className="row-body">
            <ul className="plain-list">
              <li>
                <strong>PENIS stays with holders</strong>
                <span>
                  Enrollment delegates PUMP collection, not the holder’s PENIS.
                  Funding uses the 30% activation / 25% pause thresholds.
                  Disabled collection consent counts zero at the next applicable
                  count; balances and counts are sampled rather than
                  continuously known.
                </span>
              </li>
              <li>
                <strong>200 million goal</strong>
                <span>
                  Only PENIS actually held in the permanent treasury vault
                  counts, including direct donations. Collection ends at the
                  goal, and remaining pending contributions become refundable.
                  Liquidity holdings do not count toward it.
                </span>
              </li>
              <li>
                <strong>Restricted destinations</strong>
                <span>
                  There is no discretionary admin withdrawal. Pending funds can
                  go only to their original holder or the fixed spendable
                  treasury. Permanent PENIS principal and LP holdings have no
                  withdrawal path in this code. Bounded buybacks still carry
                  price and market risks.
                </span>
              </li>
              <li>
                <strong>Keys and external controls</strong>
                <span>
                  The proposed collector and reviewer keys are immutable and
                  distinct. Admin parameter changes retain their timelock, but a
                  separate retained program upgrade authority can replace the
                  code. PUMP’s transfer hook authority could delay refunds by
                  enabling a hook. The endowment cannot override those external
                  controls.
                </span>
              </li>
            </ul>
          </div>
        </section>
        <section className="row">
          <h2 className="row-label">Before launch</h2>
          <div className="row-body">
            <p>
              Agree the reward policy, 72-hour timeout and independent role
              custody; verify that the program-owned treasury receives Stonk
              rewards; exercise failures on a test deployment; and obtain an
              independent security review. Deployment identity and
              upgrade-authority policy remain unresolved. No key-destruction
              date is promised.
            </p>
            <p>
              The <a href="/security-review.pdf">historical review</a> covers{" "}
              <a
                href={`https://github.com/The-Endowment/endowment/commit/${legacyCommit}`}
              >
                an earlier commit
              </a>
              , not this system. Its findings and test counts do not certify the
              new work. Published pull requests are proposals until reviewed and
              integrated.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
