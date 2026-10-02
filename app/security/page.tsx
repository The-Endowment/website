import type { Metadata } from "next";
import { links } from "@/lib/site";

export const metadata: Metadata = {
  title: "Security",
  description:
    "An earlier AI-assisted review of the $PENIS Endowment, its scope, and the work still needed to verify the final deployment.",
};

const REVIEWED_COMMIT = "3bfce2c4aa4e8e560a94c749ebf273c3b53a7d58";
const commitUrl = `https://github.com/The-Endowment/endowment/commit/${REVIEWED_COMMIT}`;

const rounds = [
  { name: "Round 1: full review", scope: "The first complete contract, automation and website", result: "Every finding addressed in a redesign" },
  { name: "Round 2: full review", scope: "The shared multi-endowment contract, plus a re-check of every round-1 finding", result: "62 resolved, 12 accepted by design, 3 completed at launch" },
  { name: "Round 3: targeted review", scope: "The new counting and pricing mechanisms", result: "21 resolved, 1 accepted by design" },
  { name: "Final check", scope: "Every round-3 change, re-verified", result: "All resolved" },
  { name: "Launch rehearsal", scope: "Full launch on a fork of Solana mainnet, with the real tokens and pool", result: "7 of 7 steps passed" },
];

export default function Security() {
  return (
    <>
      <section className="wrap">
        <div className="thesis-head">
          <h1 className="display h1">Review history. Clear scope.</h1>
          <p className="lede">
            This page records an earlier AI-assisted review of commit {REVIEWED_COMMIT.slice(0, 7)}.
            The figures and report below belong to that version; they do not certify later collection changes or a live deployment.
          </p>
          <p className="note">AI-assisted review is not an independent professional audit.
            Before launch, the final contract, worker and wallet flow need verification together,
            with a public record of the exact deployed version and remaining permissions.</p>
          <div className="actions">
            <a href="/security-review.pdf" className="button button-primary" download>
              Earlier review summary (PDF)
            </a>
            <a href={commitUrl} className="button">
              Reviewed code
            </a>
          </div>
        </div>
      </section>

      <div className="wrap">
        <section className="row">
          <h2 className="row-label">Method</h2>
          <div className="row-body">
            <h3 className="statement">Every finding had to survive a skeptic.</h3>
            <ul className="plain-list">
              <li>
                <strong>Scoped reviewers</strong>
                <span>
                  Separate AI reviewers, one per attack surface: access control, token handling, pricing, counting,
                  governance, economic attacks, and the automation and website.
                </span>
              </li>
              <li>
                <strong>Adversarial verification</strong>
                <span>
                  A separate reviewer tried to refute every finding. Anything rated high had to be proven with a working
                  exploit test against the real program and real pool data.
                </span>
              </li>
              <li>
                <strong>Regression checks</strong>
                <span>Each round re-checked every earlier finding against the code, not against the fix notes.</span>
              </li>
              <li>
                <strong>Completeness critic</strong>
                <span>A final reviewer each round looked for anything the others missed.</span>
              </li>
              <li>
                <strong>Live rehearsal</strong>
                <span>
                  The whole launch was run on a fork of mainnet: opting in, dividend sweeps, the daily count, the 30%
                  switch, real buys against the $PENIS pool, pausing and settings changes.
                </span>
              </li>
            </ul>
          </div>
        </section>

        <section className="row">
          <h2 className="row-label">Results</h2>
          <div className="row-body">
            <div className="figures">
              <div className="figure">
                <span className="figure-value">152</span>
                <span className="figure-label">automated tests, including one for every exploit found</span>
              </div>
              <div className="figure">
                <span className="figure-value mono">{REVIEWED_COMMIT.slice(0, 7)}</span>
                <span className="figure-label">reviewed version — not a claim about later code</span>
              </div>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Scope</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {rounds.map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td>{r.scope}</td>
                    <td>{r.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="row">
          <h2 className="row-label">Verified</h2>
          <div className="row-body">
            <h3 className="statement">Controls assessed in that version.</h3>
            <ul className="plain-list">
              <li>
                <strong>$PENIS never leaves</strong>
                <span>No function can move $PENIS out of the vault, or withdraw locked liquidity.</span>
              </li>
              <li>
                <strong>Landlords keep what they hold</strong>
                <span>
                  The earlier balance-floor mechanism limited collection above a joining balance.
                  It did not prove that every collected PUMP was a PENIS reward; that is part of the later collection work.
                </span>
              </li>
              <li>
                <strong>Leaving never depends on us</strong>
                <span>Revoking works from any wallet, without this site.</span>
              </li>
              <li>
                <strong>Changes are slow and public</strong>
                <span>Settings changes wait 72 hours and stay within hard limits written into the code.</span>
              </li>
              <li>
                <strong>The pause is limited</strong>
                <span>It lasts at most 7 days, can&rsquo;t be renewed back to back, and can&rsquo;t move funds.</span>
              </li>
              <li>
                <strong>Safe tokens only</strong>
                <span>
                  Endowments can only be created for coins nobody can mint more of, freeze, or take back from wallets.
                </span>
              </li>
              <li>
                <strong>Fair prices</strong>
                <span>
                  Price and trade-size checks aim to limit adverse execution. They are not a guarantee against price manipulation or loss.
                </span>
              </li>
            </ul>
          </div>
        </section>

        <section className="row">
          <h2 className="row-label">Design choices</h2>
          <div className="row-body">
            <ul className="plain-list">
              <li>
                <strong>The refresher</strong>
                <span>
                  An automation key checks landlords before each daily count. It can&rsquo;t move funds, its role is
                  shown publicly for every endowment, and it can resign at any time.
                </span>
              </li>
              <li>
                <strong>Counting is public</strong>
                <span>
                  Each landlord&rsquo;s counted $PENIS is on-chain and shown on the site, so any attempt to game the
                  count is costly and visible.
                </span>
              </li>
              <li>
                <strong>Outside token settings</strong>
                <span>
                  PUMP and $PENIS each have a setting controlled by a third party. If either changes, the endowment
                  pauses buying and sweeping on its own, to reduce exposure; this is not a guarantee against losses.
                </span>
              </li>
            </ul>
          </div>
        </section>

        <section className="row">
          <h2 className="row-label">The code</h2>
          <div className="row-body">
            <p>
              The review covered commit{" "}
              <a href={commitUrl}>
                <span className="mono">{REVIEWED_COMMIT.slice(0, 7)}</span>
              </a>{" "}
              of the <a href={links.github}>open-source contract</a>. Later changes need their own review evidence.
              The final deployment must be checked against its published source version. Upgrade authority,
              administration and operating roles should each be disclosed; this page does not claim that any keys have been removed.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
