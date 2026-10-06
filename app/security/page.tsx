import type { Metadata } from "next";
import { links } from "@/lib/site";

export const metadata: Metadata = {
  title: "Security",
  description:
    "The $PENIS Endowment's historical AI-assisted review, later collection reviews, and the protections and trust assumptions in the current design.",
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
            The original contract went through three rounds of AI-assisted adversarial review, a final focused check,
            and a launch rehearsal on a fork of mainnet. That review covered a specific version of the code. Later
            collection, hold and recovery changes received separate AI-assisted reviews in October 2026. These reviews
            help find and fix faults; they are not a professional audit or a guarantee that no faults remain.
          </p>
          <div className="actions">
            <a href="/security-review.pdf" className="button button-primary" download>
              Historical summary (PDF)
            </a>
            <a href={commitUrl} className="button">
              Historically reviewed code
            </a>
          </div>
        </div>
      </section>

      <div className="wrap">
        <section className="row">
          <h2 className="row-label">Method</h2>
          <div className="row-body">
            <h3 className="statement">Every finding had to survive a skeptic.</h3>
            <p>The historical review summary describes this process:</p>
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
                  A separate AI reviewer tried to refute every finding. Anything rated high had to be proven with a working
                  exploit test against the real program and real pool data.
                </span>
              </li>
              <li>
                <strong>Regression checks</strong>
                <span>Each round re-checked every earlier finding against the code, not against the fix notes.</span>
              </li>
              <li>
                <strong>Completeness critic</strong>
                <span>A final AI reviewer each round looked for anything the others missed.</span>
              </li>
              <li>
                <strong>Fork rehearsal</strong>
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
            <p>
              The summary for commit <a href={commitUrl}><span className="mono">{REVIEWED_COMMIT.slice(0, 7)}</span></a>{" "}
              reported the results below. These are historical results, before the later collection and recovery changes.
            </p>
            <div className="figures">
              <div className="figure">
                <span className="figure-value">152</span>
                <span className="figure-label">automated tests reported in the historical review</span>
              </div>
              <div className="figure">
                <span className="figure-value">7/7</span>
                <span className="figure-label">steps passed in the historical mainnet-fork rehearsal</span>
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
          <h2 className="row-label">Later reviews</h2>
          <div className="row-body">
            <p>
              October 2026 reviews covered the refundable hold, payout checks and wallet recovery. Follow-up fixes
              addressed receipt discovery, access to reclaim when joining is closed, refunds after a landlord record
              is removed, and consent wording. The changes and their validation are recorded in the{" "}
              <a href="https://github.com/The-Endowment/endowment/pull/5">contract follow-up</a> and{" "}
              <a href="https://github.com/The-Endowment/website/pull/5">website recovery follow-up</a>.
            </p>
            <p>
              Those were focused AI-assisted code and integration reviews. A funded pilot, operational checks, and
              verification of the final deployed build and configuration remain separate launch requirements.
            </p>
          </div>
        </section>

        <section className="row">
          <h2 className="row-label">Protections</h2>
          <div className="row-body">
            <h3 className="statement">Limits written into the current source.</h3>
            <p>These limits describe the current code. Retained upgrade authority can change that code.</p>
            <ul className="plain-list">
              <li>
                <strong>Treasury $PENIS stays put</strong>
                <span>The current program has no instruction to withdraw treasury $PENIS or locked liquidity.</span>
              </li>
              <li>
                <strong>Collection has limits</strong>
                <span>
                  Collection is bounded by the PUMP baseline and vault cap, and by the reward allowance when enabled.
                  An allowance limits the amount; it does not prove that a wallet received an eligible payout.
                </span>
              </li>
              <li>
                <strong>A hold before release</strong>
                <span>
                  Collected PUMP waits at least 24 hours and needs a separate reviewer&rsquo;s approval before release.
                  You can reclaim any still-pending receipt until actual release, including after 24 hours. Reclaiming
                  a receipt from your current consent switches collection off; an older receipt does not cancel newer consent.
                </span>
              </li>
              <li>
                <strong>You control collection consent</strong>
                <span>
                  You can stop collection and revoke the PUMP approval. The token program also supports revoking without
                  this site. Revoking does not return PUMP already collected; pending receipts have a separate reclaim action.
                </span>
              </li>
              <li>
                <strong>Settings changes are public</strong>
                <span>
                  Parameter and collection-role changes wait 72 hours. This delay applies to those settings, not to
                  program upgrades.
                </span>
              </li>
              <li>
                <strong>The pause is limited</strong>
                <span>It lasts at most 7 days, can&rsquo;t be renewed back to back, and can&rsquo;t move funds.</span>
              </li>
              <li>
                <strong>Token checks</strong>
                <span>
                  Collection and buying check transfer hooks, fee limits and frozen trading accounts. Token settings
                  controlled outside the endowment remain dependencies, as described below.
                </span>
              </li>
              <li>
                <strong>Price limits</strong>
                <span>
                  Buys use the pool&rsquo;s recent average and limits based on its depth. These controls bound execution;
                  they do not guarantee a fair price or eliminate market manipulation and trading losses.
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
                <strong>Eligible rewards need evidence</strong>
                <span>
                  Only PUMP rewards earned by your $PENIS are intended for collection. The collector and reviewer use
                  off-chain payout and wallet-history records to identify them. Mistaken collections can reach holding,
                  including when rewards are spent and replaced before collection; review is intended to return the
                  ineligible part. Separate keys still share risks from verifier code, data feeds and RPC providers.
                </span>
              </li>
              <li>
                <strong>The PUMP approval is unlimited</strong>
                <span>
                  Joining grants an unlimited token approval on the delegated PUMP account. The baseline, allowance and
                  collection rules come from the program, not the approval itself. Your $PENIS and other token accounts
                  are not included in that approval.
                </span>
              </li>
              <li>
                <strong>The refresher</strong>
                <span>
                  An automation key checks landlords before each daily count and posts the aggregate reward total used
                  for allowances. Its posts are trusted inputs, bounded by the program; they are not proof of an individual
                  wallet&rsquo;s payout.
                </span>
              </li>
              <li>
                <strong>Counting is public</strong>
                <span>
                  Each landlord&rsquo;s counted $PENIS is recorded on-chain for anyone to check. Public records support
                  scrutiny, but do not establish the origin of PUMP in a wallet.
                </span>
              </li>
              <li>
                <strong>Outside token settings</strong>
                <span>
                  PUMP&rsquo;s transfer-hook authority and $PENIS&rsquo;s transfer-fee authority remain outside the
                  endowment&rsquo;s control. Unsupported settings stop collection and buying. A PUMP hook could also
                  delay transfers back to holders, so a refund right does not guarantee an immediate transfer.
                </span>
              </li>
              <li>
                <strong>Retained upgrade authority</strong>
                <span>
                  While program upgrade authority is retained, its controller can change these rules. Renouncing the endowment admin
                  does not remove that authority or the collector, reviewer and refresher roles. Admin renunciation
                  also removes the guardian and freezes collection-role rotation.
                </span>
              </li>
            </ul>
          </div>
        </section>

        <section className="row">
          <h2 className="row-label">The code</h2>
          <div className="row-body">
            <p>
              The historical PDF covers commit{" "}
              <a href={commitUrl}>
                <span className="mono">{REVIEWED_COMMIT.slice(0, 7)}</span>
              </a>{" "}
              of the <a href={links.github}>open-source contract</a>. Later changes are outside that review&rsquo;s scope.
              The final deployed artifact has not yet been verified here against its exact source revision and launch
              configuration. A source review alone does not establish what code is running on-chain.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
