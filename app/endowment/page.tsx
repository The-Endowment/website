import type { Metadata } from "next";
import Link from "next/link";
import { Campaign } from "@/components/Campaign";
import { DotLogo } from "@/components/Logo";
import { links } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: "The $PENIS Endowment" },
  description:
    "Permanent capital. Landlords lend the endowment their PUMP rewards, and it turns them into $PENIS it holds forever.",
};

const faqs = [
  {
    q: "What does the endowment collect?",
    a: "Only the PUMP your $PENIS earns. Each day the contract works out what every committed wallet's $PENIS earned from stonk.fun's public reward total, and collects at most that. The PUMP you held when you joined is never collected.",
  },
  {
    q: "What if I buy PUMP or hold other coins in the same wallet?",
    a: "The endowment only ever collects up to what your $PENIS earned, so PUMP you buy and rewards from other coins stay yours. We still recommend a wallet that holds just the $PENIS you're committing, so your records stay simple.",
  },
  {
    q: "Can I commit only part of my $PENIS?",
    a: "Yes. Commitment is per wallet: the $PENIS in the wallet you delegate counts, and its rewards go to the endowment. Keep the $PENIS you want to commit in one wallet and the rest in another.",
  },
  {
    q: "Can I leave?",
    a: "Yes, anytime. The Leave button revokes the delegation and removes your landlord record in one step, and revoking works from any Solana wallet without this site or anyone's permission.",
  },
  {
    q: "Who runs it?",
    a: "No one, by design. After a public testing period, the key that can change the contract is destroyed, so no one can ever change its rules or move its $PENIS, including us. Every action is posted publicly, and the endowment has no connection to the coin's creators.",
  },
  {
    q: "What happens at 200 million?",
    a: "The endowment reaches its goal. Once it holds 200 million $PENIS, whether bought or sent to it directly, it stops taking contributions and holds everything it has forever.",
  },
  {
    q: "Can I check the code?",
    a: "Yes. The contract is open source on GitHub, and every rule on this page is enforced by it.",
  },
  {
    q: "When does it open?",
    a: "Collection switches on once committed landlords hold 30% of all $PENIS, as measured by a daily on-chain count. A landlord's $PENIS counts from its second count, once it has been held from one count to the next, and every landlord's record is public on-chain.",
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
            The $PENIS Endowment turns every PUMP it earns into more $PENIS, and holds it forever. It is the one holder
            that can never pull out.
          </p>
          <div className="actions">
            <Link href="/delegate" className="button button-primary">
              Delegate your PUMP
            </Link>
            <Link href="#how" className="button">
              How it works
            </Link>
          </div>
        </div>
        <DotLogo className="hero-art" label="The endowment's mark, a temple drawn in dots" />
      </section>
      <Campaign />
      <section id="how" className="row">
        <h2 className="row-label">How it works</h2>
        <div className="row-body">
          <h3 className="statement">Landlords lend their rent. The endowment keeps the building.</h3>
          <p>
            The largest holders, the landlords, lend the endowment their PUMP rewards. The endowment turns that income
            into $PENIS it can never sell.
          </p>
          <ol className="steps">
            <li>
              <h3>Delegate</h3>
              <p>One transaction gives the endowment access to your PUMP rewards and nothing else.</p>
            </li>
            <li>
              <h3>Collect</h3>
              <p>Once a day, it collects the PUMP your $PENIS earned that day, and never more.</p>
            </li>
            <li>
              <h3>Compound</h3>
              <p>It buys $PENIS in small amounts and locks it in the vault, where it stays forever.</p>
            </li>
          </ol>
        </div>
      </section>

      <section className="row">
        <h2 className="row-label">How it spends</h2>
        <div className="row-body">
          <h3 className="statement">Every PUMP buys $PENIS.</h3>
          <p>
            The endowment buys in small, spaced-out amounts with whatever PUMP it holds, each priced against the
            pool&rsquo;s recent average. Nothing is sold, and nothing is spent on anything else.
          </p>
          <div className="figures">
            <div className="figure">
              <span className="figure-value">200,000,000</span>
              <span className="figure-label">$PENIS, the endowment&rsquo;s goal</span>
            </div>
            <div className="figure">
              <span className="figure-value">20%</span>
              <span className="figure-label">of all $PENIS, held forever</span>
            </div>
          </div>
          <p>
            $PENIS sent to the endowment directly counts toward the goal too. At 200 million it stops taking
            contributions, and everything it holds stays locked.
          </p>
        </div>
      </section>

      <section className="row">
        <h2 className="row-label">Guarantees</h2>
        <div className="row-body">
          <h3 className="statement">Written into the contract, not promised in a thread.</h3>
          <ul className="plain-list">
            <li>
              <strong>Only what your $PENIS earned</strong>
              <span>
                The contract caps each day&rsquo;s collection at what your $PENIS earned, and never touches the PUMP you
                held when you joined.
              </span>
            </li>
            <li>
              <strong>It never sells</strong>
              <span>The contract has no function that can sell or withdraw its $PENIS.</span>
            </li>
            <li>
              <strong>You can always leave</strong>
              <span>Revoke straight from your wallet, anytime, with no permission needed.</span>
            </li>
            <li>
              <strong>The pause is limited</strong>
              <span>It can&rsquo;t move funds, lifts on its own after seven days, and can&rsquo;t be renewed back to back.</span>
            </li>
            <li>
              <strong>Rule changes are announced</strong>
              <span>Any change to the limits, or retiring the endowment, waits 72 hours on-chain before it takes effect.</span>
            </li>
            <li>
              <strong>Locked forever</strong>
              <span>After a public testing period, the upgrade key is destroyed. No one can change the rules.</span>
            </li>
            <li>
              <strong>Everything is public</strong>
              <span>
                The <a href={links.github}>source code</a> is open, and every collection and buy is posted to{" "}
                <a href={links.x}>@PenisEndowment</a>.
              </span>
            </li>
            <li>
              <strong>Security reviewed</strong>
              <span>
                Three rounds of AI-assisted adversarial review and a live launch rehearsal.{" "}
                <Link href="/security">See the review</Link>.
              </span>
            </li>
          </ul>
        </div>
      </section>

      <section className="band">
        <blockquote>
          Trading creates rent. <span>Rent keeps supply off the market.</span>
        </blockquote>
        <Link href="/thesis" className="muted">
          Read the landlord thesis
        </Link>
      </section>

      <section id="status" className="row">
        <h2 className="row-label">Status</h2>
        <div className="row-body">
          <h3 className="statement">Built, tested, and ready for the landlords.</h3>
          <p>
            Collection switches on once committed landlords hold 30% of all $PENIS, starting with the founding
            landlords. Follow <a href={links.x}>@PenisEndowment</a> for the announcement.
          </p>
          <p className="muted small">
            Building on another dividend coin? <Link href="/build">Start an endowment for your project</Link>.
          </p>
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
