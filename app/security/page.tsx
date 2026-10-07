import type { Metadata } from "next";
import { links } from "@/lib/site";

export const metadata: Metadata = {
  title: "Security",
  description:
    "How the $PENIS Endowment contract was reviewed: an AI-assisted adversarial security review in three rounds, a final check and a live launch rehearsal.",
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
          <h1 className="display h1">Reviewed, then reviewed again.</h1>
          <p className="lede">
            The original contract was put through an AI-assisted adversarial security review: three rounds, a final
            focused check, and a full launch rehearsal on a fork of mainnet. The 24-hour hold, reward cap and wallet
            recovery added since then went through their own AI-assisted reviews in October 2026, with every finding
            fixed before it was merged.
          </p>
          <div className="actions">
            <a href="/security-review.pdf" className="button button-primary" download>
              Original review (PDF)
            </a>
            <a href={commitUrl} className="button">
              Originally reviewed code
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
                  Independent reviewers, one per attack surface: access control, token handling, pricing, counting,
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
            <p>The original review, of commit {REVIEWED_COMMIT.slice(0, 7)}:</p>
            <div className="figures">
              <div className="figure">
                <span className="figure-value">152</span>
                <span className="figure-label">automated tests, including one for every exploit found</span>
              </div>
              <div className="figure">
                <span className="figure-value">0</span>
                <span className="figure-label">ways found, in any round, for anyone to take funds</span>
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
            <p>
              The October reviews of the 24-hour hold, reward cap and wallet recovery found no way to take funds either.
              Everything they did find was fixed before it was merged.
            </p>
          </div>
        </section>

        <section className="row">
          <h2 className="row-label">Verified</h2>
          <div className="row-body">
            <h3 className="statement">What the current contract enforces.</h3>
            <ul className="plain-list">
              <li>
                <strong>No discretionary withdrawals</strong>
                <span>The current program cannot pay treasury $PENIS or locked liquidity to an operator. It can use $PENIS for the configured permanent liquidity deposits after the goal.</span>
              </li>
              <li>
                <strong>Landlords keep what they hold</strong>
                <span>
                  Collections cannot reduce PUMP below the recorded starting balance and are limited by an allowance
                  calculated from posted reward totals. The approval covers only that PUMP account.
                </span>
              </li>
              <li>
                <strong>Held before it&rsquo;s used</strong>
                <span>
                  Every collection waits at least 24 hours in a separate account and needs a second reviewer&rsquo;s
                  approval. Until it&rsquo;s released, it can only go to the vault or back to its landlord, who can take
                  it back at any time.
                </span>
              </li>
              <li>
                <strong>Leaving never depends on us</strong>
                <span>Revoking works from any wallet, without this site.</span>
              </li>
              <li>
                <strong>Changes are slow and public</strong>
                <span>
                  Parameter and collection-operator changes wait 72 hours and stay within hard limits
                  written into the code.
                </span>
              </li>
              <li>
                <strong>An incident stays stopped</strong>
                <span>A guardian can pause collection, release and buybacks. Restart requires the admin; holder exits and refunds remain available. Receipt expiry is never extended by a pause.</span>
              </li>
              <li>
                <strong>Token checks</strong>
                <span>
                  Collecting and buying stop on unsupported transfer hooks, fees above the allowed limits, or when an
                  account is frozen.
                </span>
              </li>
              <li>
                <strong>Fair prices</strong>
                <span>
                  Buys are priced against the pool&rsquo;s own recent average and sized to its depth, so a trade placed
                  just before a buy can&rsquo;t push far against the endowment.
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
                <strong>Spotting rewards</strong>
                <span>
                  PUMP from rewards and PUMP bought look the same on-chain, so the collector and reviewer check
                  stonk.fun&rsquo;s payout records and each wallet&rsquo;s history. They use separate keys but share code
                  and data sources, so mistakes can affect both. The contract limits collection using trusted posted
                  reward totals, holds it for at least 24 hours, and lets the landlord reclaim before release. These
                  controls reduce risk; after release, this contract has no refund path for that contribution.
                </span>
              </li>
              <li>
                <strong>An unlimited approval</strong>
                <span>
                  Joining approves the endowment on your PUMP account for an unlimited amount, which keeps counting
                  simple. What it can actually collect is set by the contract&rsquo;s cap and baseline, not by the
                  approval. Your $PENIS and other tokens aren&rsquo;t included.
                </span>
              </li>
              <li>
                <strong>The refresher</strong>
                <span>
                  An automation key checks landlords before each daily count and posts stonk.fun&rsquo;s reward total,
                  which sets the cap. It can&rsquo;t move funds, the contract bounds what any post can credit, and it can
                  resign at any time.
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
                  PUMP and $PENIS each have a setting controlled by a third party. Unsupported hooks or fees above the
                  allowed limits stop buying and collecting. A PUMP transfer hook could also delay returning a held
                  collection until it&rsquo;s switched off.
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
              of the <a href={links.github}>open-source contract</a>; the October reviews covered the changes since. The
              deployed program will be a verifiable build of the code on GitHub, so anyone can confirm what is running.
              While upgrade authority exists, it can change the code and its protections. Removing it is a separate
              decision after testing and review. Admin authority is separate: production thresholds and the reward
              allowance remain fixed, while bounded parameter changes, operator replacement and emergency restart
              remain possible. Admin renunciation is unavailable while contribution collection is live.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
