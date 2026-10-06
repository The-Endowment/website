import type { Metadata } from "next";
import Link from "next/link";
import { DelegateButton, DelegationNote } from "@/components/DelegateButton";
import { DonationButton } from "@/components/DonationButton";
import { EndowmentProgress } from "@/components/EndowmentProgress";
import { DotLogo } from "@/components/Logo";
import { links } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: "The $PENIS Endowment" },
  alternates: { canonical: "/endowment" },
  description:
    "Holders are building a long-term $PENIS reserve through reward pledges and planned direct donations.",
};

const faqs = [
  {
    q: "What does the endowment collect?",
    a: "The pledge covers 100% of eligible PUMP rewards from your wallet's $PENIS. The collector checks PENIS payout records and wallet history. The contract also applies a protected starting balance and an allowance based on posted reward totals and counted holdings. The allowance limits the amount; payout verification identifies eligible rewards.",
  },
  {
    q: "What if I buy PUMP or hold other coins in the same wallet?",
    a: "Purchases, existing PUMP and other coins' rewards are excluded from the pledge. Verification relies on off-chain data and services and can make mistakes. For example, spending rewards and buying PUMP before collection can result in purchased PUMP being collected temporarily. A separate reviewer checks each collection before release and can refund incorrect amounts. You can reclaim pending funds until release, including after the minimum 24-hour hold.",
  },
  {
    q: "Can I donate $PENIS instead?",
    a: "Direct donations are planned and are not open yet. A donation permanently transfers $PENIS to the vault without ongoing collection permission. Only the net amount received after transfer fees counts toward 200 million. Direct donations do not have the pending-PUMP reclaim window. The vault and donation flow need verification before opening.",
  },
  {
    q: "Can I commit only part of my $PENIS?",
    a: "Yes. A pledge is per wallet: the $PENIS in the wallet you pledge counts, and its rewards go to the endowment. Keep the $PENIS you want to commit in one wallet and the rest in another.",
  },
  {
    q: "Can someone pledge my wallet for me?",
    a: "No. Pledging needs your wallet's signature. Nobody can sign you up with your address alone.",
  },
  {
    q: "Can I take a collection back?",
    a: "Yes. Every collection is held for at least 24 hours, and you can reclaim it with your wallet's signature until it is released, even after 24 hours. Reclaiming a contribution from your current pledge also stops collection. Reclaiming an older pledge's contribution leaves your newer pledge unchanged. Use Stop collection to disable that newer pledge; re-enabling requires your signature and open enrollment.",
  },
  {
    q: "Can I leave?",
    a: "Yes. Leave removes your landlord record and revokes this endowment's token approval when present. Independent Stop collection and Revoke PUMP approval controls remain available if the balance dashboard fails or new pledges close. Revoke stops new transfers; reclaim returns pending funds. Your wallet must sign each action, and the chain must confirm it. Released contributions have no holder-reclaim path.",
  },
  {
    q: "What counts toward 200 million?",
    a: "The $PENIS in the endowment's vault, whether bought or donated. Pledged wallets keep their own $PENIS, so it doesn't count, and neither does $PENIS added to liquidity.",
  },
  {
    q: "Who runs it?",
    a: "Operators run the collector, reviewer and keeper. The current contract restricts receipt settlement to release into the treasury or refund to its holder. A retained upgrade authority can change the code and those protections. Operator assignments, key custody and any authority-removal plan still need agreement and publication before pledging opens. Renouncing the admin does not remove the upgrade authority or the collection and review roles.",
  },
  {
    q: "When does it open?",
    a: "New pledges are closed while launch checks are completed. The participation rule activates at 30% of supply counted, pauses below 25%, and resumes at 30%. A wallet's first count records its balance; later counts also require the refresher's qualifying checks. Collection requires consent, working services and the other safety checks, and ends when the vault reaches 200 million $PENIS.",
  },
  {
    q: "Can I check the code?",
    a: "Yes. The contract and collection services are open source on GitHub. The contract enforces permissions, limits and settlement rules; payout attribution also depends on off-chain services. The security page separates the earlier review from later changes and the deployment checks still needed.",
  },
];

export default function Endowment() {
  return (
    <div className="wrap">
      <section className="hero">
        <div className="hero-copy">
          <h1 className="display h1">
            Permanent capital.
            <br />
            <em>Firm</em> commitments.
          </h1>
          <p className="lede">
            The $PENIS Endowment turns reviewed PUMP contributions into a long-term reserve of $PENIS. Its current
            contract has no function to sell or withdraw the principal vault&rsquo;s $PENIS.
          </p>
          <div className="actions">
            <DelegateButton label="Pledge your PUMP" primary />
            <Link href="#how" className="button">
              How it works
            </Link>
          </div>
          <DelegationNote />
        </div>
        <DotLogo className="hero-art" label="The endowment's mark, a temple drawn in dots" />
      </section>

      <EndowmentProgress detailPage />

      <section id="how" className="row">
        <h2 className="row-label">How it works</h2>
        <div className="row-body">
          <h3 className="statement">Landlords pledge their rent. The endowment keeps the building.</h3>
          <p>
            Holders pledge eligible PUMP rewards and keep their $PENIS in their wallets. Approved collections fund
            the endowment&rsquo;s purchases. The current contract holds those coins; retained upgrade authority can change its rules.
          </p>
          <ol className="steps">
            <li>
              <h3>Pledge</h3>
              <p>Your signature grants PUMP approval and pledges eligible $PENIS rewards. Review the permission and recovery terms before signing.</p>
            </li>
            <li>
              <h3>Collect and hold</h3>
              <p>Payout checks and a contract allowance limit collection. Each contribution is held for at least 24 hours and remains reclaimable until release.</p>
            </li>
            <li>
              <h3>Compound</h3>
              <p>Approved collections fund small $PENIS purchases to build the reserve toward 200 million coins.</p>
            </li>
          </ol>
        </div>
      </section>

      <section id="donate" className="row">
        <h2 className="row-label">Donations</h2>
        <div className="row-body">
          <h3 className="statement">A one-time gift. A permanent holding.</h3>
          <p>
            A direct donation is a planned way to contribute $PENIS in one transfer, without an ongoing reward pledge.
            Donations are not open yet.
          </p>
          <ul className="plain-list">
            <li>
              <strong>Straight to the vault</strong>
              <span>Donations are permanent contributions to the principal vault and have no pending-PUMP reclaim window.</span>
            </li>
            <li>
              <strong>Counts at once</strong>
              <span>Only the net $PENIS received after transfer fees counts toward the 200 million goal.</span>
            </li>
            <li>
              <strong>Clear before you sign</strong>
              <span>Before donations open, the wallet flow must show the amount sent, expected net receipt and verified vault address.</span>
            </li>
          </ul>
          <div className="actions">
            <DonationButton />
            <Link href="#how" className="button">
              Pledge rewards instead
            </Link>
          </div>
        </div>
      </section>

      <section className="row">
        <h2 className="row-label">How it spends</h2>
        <div className="row-body">
          <h3 className="statement">Reviewed rewards build the reserve.</h3>
          <p>
            The endowment buys in small, spaced-out amounts with the PUMP it holds, each priced against the
            pool&rsquo;s recent average. The code also allows bounded caller tips and a buy/liquidity split after the
            goal. Pending contributions stay separate until approved for release.
          </p>
        </div>
      </section>

      <section id="safeguards" className="row">
        <h2 className="row-label">Safeguards</h2>
        <div className="row-body">
          <h3 className="statement">Collection limits, review and recovery.</h3>
          <ul className="plain-list">
            <li>
              <strong>A reward pledge with verification</strong>
              <span>
                The collector checks PENIS payouts and wallet history. The contract adds an allowance and protected
                starting balance. Verification can make mistakes; the allowance alone does not prove where PUMP came from.
              </span>
            </li>
            <li>
              <strong>Held for at least 24 hours</strong>
              <span>
                A separate reviewer checks each collection before approving release and can refund incorrect amounts.
                You can reclaim any pending contribution until it is released, even after 24 hours.
              </span>
            </li>
            <li>
              <strong>Two places only</strong>
              <span>The current settlement code releases held PUMP to the treasury or returns it to its original holder.</span>
            </li>
            <li>
              <strong>Principal held by the contract</strong>
              <span>The current contract has no function that can sell or withdraw the principal vault&rsquo;s $PENIS.</span>
            </li>
            <li>
              <strong>Holder-controlled exit</strong>
              <span>Your signature can stop collection or revoke PUMP approval. These actions require no operator permission.</span>
            </li>
            <li>
              <strong>Timelocked settings</strong>
              <span>Parameter changes and retirement wait at least 72 hours under the current code. This delay does not enforce a timelock on program upgrades.</span>
            </li>
            <li>
              <strong>Upgrade authority matters</strong>
              <span>A retained upgrade authority can change the code and its protections. Custody and any removal plan must be agreed and disclosed before launch.</span>
            </li>
            <li>
              <strong>Everything is public</strong>
              <span>
                The <a href={links.github}>source code</a> and on-chain transactions are public. Follow{" "}
                <a href={links.x}>@PenisEndowment</a> for project updates.
              </span>
            </li>
            <li>
              <strong>Security reviewed</strong>
              <span>
                The earlier code had an AI-assisted review and fork rehearsal. Later reviews covered the holding,
                refund and recovery changes. Deployment verification and a controlled pilot remain. <Link href="/security">See the review scope</Link>.
              </span>
            </li>
          </ul>
        </div>
      </section>

      <section id="status" className="row">
        <h2 className="row-label">Status</h2>
        <div className="row-body">
          <h3 className="statement">Opening soon.</h3>
          <p>
            Participation opens after deployment, permissions and recovery checks are reviewed. The testing plan and
            operator roles still need agreement. Follow{" "}
            <a href={links.x}>@PenisEndowment</a> for the announcement.
          </p>
        </div>
      </section>

      <section id="open-source" className="row">
        <h2 className="row-label">Open source</h2>
        <div className="row-body">
          <h3 className="statement">Built in the open, for anyone to use.</h3>
          <p>
            The endowment&rsquo;s contract, website and automation are open source under the Apache-2.0 license. Any
            project with a dividend-paying coin is welcome to take the code and run an endowment of its own.
          </p>
          <div className="actions">
            <a href={links.github} className="button">
              View the source on GitHub
            </a>
          </div>
        </div>
      </section>

      <section id="questions" className="row">
        <h2 className="row-label">Questions</h2>
        <div className="row-body">
          <div className="faq">
            {faqs.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
