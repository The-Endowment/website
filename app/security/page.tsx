import type { Metadata } from "next";
import { links } from "@/lib/site";

export const metadata: Metadata = {
  title: "Security",
  description:
    "The $PENIS Endowment's current review status, trusted reward reporter, contract safeguards and remaining launch requirements.",
};

const LEGACY_REVIEWED_COMMIT = "3bfce2c4aa4e8e560a94c749ebf273c3b53a7d58";
const commitUrl = `https://github.com/The-Endowment/endowment/commit/${LEGACY_REVIEWED_COMMIT}`;

export default function Security() {
  return (
    <>
      <section className="wrap">
        <div className="thesis-head">
          <h1 className="display h1">Safeguards, trust and review.</h1>
          <p className="lede">
            The version 4 replacement is being developed and reviewed locally. New enrollment and automated
            contributions remain closed here. The current work has not received an independent security audit
            and is not an authorized production release.
          </p>
          <div className="actions">
            <a href="/security-review.pdf" className="button button-primary" download>
              Historical review (PDF)
            </a>
            <a href={commitUrl} className="button">
              Legacy reviewed commit
            </a>
          </div>
        </div>
      </section>

      <div className="wrap">
        <section className="row">
          <h2 className="row-label">Reward collection</h2>
          <div className="row-body">
            <h3 className="statement">A trusted reporter identifies eligible PUMP.</h3>
            <ul className="plain-list">
              <li>
                <strong>What the pledge covers</strong>
                <span>
                  All verified StonkFun rewards paid in PUMP after fresh enrollment while funding is active,
                  including PUMP rewards from other coins in the same wallet. Rewards paid in STONK or other
                  assets are excluded.
                </span>
              </li>
              <li>
                <strong>What the reporter must exclude</strong>
                <span>
                  Existing PUMP, purchases, ordinary transfers and rewards paid while funding is inactive do not
                  create eligibility. Spending reduces eligible rewards; buying replacements does not restore them.
                  This classification depends on the reporter, not on an on-chain proof of each reward.
                </span>
              </li>
              <li>
                <strong>No daily wallet cap</strong>
                <span>
                  The pledge has no daily contribution cap per wallet. It uses a broad, revocable PUMP token
                  approval. A mistaken or compromised reporter could collect PUMP that the policy excludes,
                  within the available approval, balance and contract constraints.
                </span>
              </li>
              <li>
                <strong>Checks on each collection</strong>
                <span>
                  The replacement checks the authorized reporter, fresh consent, exact amount, expiry and replay
                  protection, and sends contributions only to the configured treasury. These checks do not prove
                  that the reporter classified the PUMP correctly.
                </span>
              </li>
              <li>
                <strong>Daily oversight</strong>
                <span>
                  An approximate daily comparison with StonkFun reward totals can flag discrepancies for
                  investigation. Matching totals cannot prove that each wallet was charged correctly.
                </span>
              </li>
            </ul>
          </div>
        </section>

        <section className="row">
          <h2 className="row-label">Review status</h2>
          <div className="row-body">
            <table className="table">
              <thead>
                <tr>
                  <th>Work</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Version 4 contract, reporter and website</td>
                  <td>Local implementation, automated tests and AI-assisted adversarial review in progress</td>
                </tr>
                <tr>
                  <td>Independent security review</td>
                  <td>Pending; AI-assisted review is not an independent audit or certification</td>
                </tr>
                <tr>
                  <td>Treasury rewards and governance</td>
                  <td>Program-owned treasury reward eligibility and the upgrade-authority policy still need verification and agreement</td>
                </tr>
                <tr>
                  <td>Deployment and limited pilot</td>
                  <td>Not authorized by these local changes; deployment identity and release checks remain outstanding</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="row">
          <h2 className="row-label">Contract safeguards</h2>
          <div className="row-body">
            <h3 className="statement">Rules in the replacement under review.</h3>
            <ul className="plain-list">
              <li>
                <strong>Restricted treasury use</strong>
                <span>
                  There is no admin or reporter withdrawal instruction. The buyback process can move $PENIS from
                  the vault into permanently locked liquidity, so the direct vault balance can change.
                </span>
              </li>
              <li>
                <strong>Holder $PENIS is not pledged</strong>
                <span>
                  Enrollment delegates PUMP collection, not access to the holder&rsquo;s $PENIS. Funding starts at
                  30% committed, pauses below 25%, and resumes at 30%. Holder collection stops permanently when
                  the direct treasury vault reaches 200 million $PENIS; liquidity holdings do not count toward that goal.
                </span>
              </li>
              <li>
                <strong>Revocation remains available</strong>
                <span>
                  Holders can revoke the PUMP approval directly through the token program without the reporter or
                  this site. Completed contributions are not refunded. Existing approvals require separate revocation;
                  this website update does not change old deployments.
                </span>
              </li>
              <li>
                <strong>Changes are slow and public</strong>
                <span>
                  Parameter changes and reporter replacement use a 72-hour timelock in the current design.
                  Retained program upgrade authority can replace the code and override these safeguards;
                  the timelock does not constrain that separate authority.
                </span>
              </li>
              <li>
                <strong>Bounded buying</strong>
                <span>
                  Trade size, pool depth and recent average price constrain buys. These checks limit exposure but
                  do not guarantee a fair market price or prevent all manipulation and losses.
                </span>
              </li>
              <li>
                <strong>Outside token controls</strong>
                <span>
                  The contract checks supported mint authorities and token settings before relevant operations.
                  Third-party token controls remain a dependency; detecting a change and stopping an operation
                  cannot guarantee that funds retain their value or that no loss occurs.
                </span>
              </li>
            </ul>
          </div>
        </section>

        <section className="row">
          <h2 className="row-label">Other dependencies</h2>
          <div className="row-body">
            <ul className="plain-list">
              <li>
                <strong>The refresher</strong>
                <span>
                  An automation key checks landlords before each daily count. It can&rsquo;t move funds, its role is
                  recorded on-chain, and it can resign. This counting role is separate from the reporter that
                  authorizes PUMP collection.
                </span>
              </li>
              <li>
                <strong>Counts need fresh evidence</strong>
                <span>
                  Counted balances are public, but holdings can change between observations. Freshness checks and
                  invalidation after refresher changes constrain when collection may proceed.
                </span>
              </li>
              <li>
                <strong>Incomplete reward history</strong>
                <span>
                  Missing API records or uncertain wallet history leave the affected rewards with holders. The
                  system may collect less than the full pledge; it does not infer a debt from a wallet balance.
                </span>
              </li>
            </ul>
          </div>
        </section>

        <section className="row">
          <h2 className="row-label">Historical materials</h2>
          <div className="row-body">
            <p>
              The linked PDF describes an earlier AI-assisted review of legacy commit{" "}
              <a href={commitUrl}>
                <span className="mono">{LEGACY_REVIEWED_COMMIT.slice(0, 7)}</span>
              </a>{" "}
              of the <a href={links.github}>open-source contract</a>. Its test counts, findings and rehearsal results
              do not cover or certify the version 4 replacement. The repository link provides published source;
              the local replacement is still being prepared for review.
            </p>
            <p>
              Before launch, the reviewed release must be matched to the deployed program. Whether and when to
              remove upgrade authority remains a governance decision; no key-destruction date is promised.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
