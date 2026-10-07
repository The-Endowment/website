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
    "Permanent capital. Holders pledge their PUMP rewards, and the endowment turns them into $PENIS it holds.",
};

const faqs = [
  {
    q: "What does the endowment collect?",
    a: "The PUMP your $PENIS earns. Each day the contract works out what every pledged wallet's $PENIS earned from stonk.fun's public reward total, and caps collection at that. The PUMP you held when you joined is never collected.",
  },
  {
    q: "What if I buy PUMP or hold other coins in the same wallet?",
    a: "They stay yours. The collector checks each payout before it collects, and the contract caps every collection at what your $PENIS earned. If a collection ever does include PUMP you bought (say you spent your rewards and bought PUMP just before it), the reviewer returns it during the 24-hour hold, and you can take it back yourself until it's released.",
  },
  {
    q: "Can I donate $PENIS instead?",
    a: "Soon. A donation will send $PENIS straight to the endowment's vault in one transfer, with no ongoing permission. It counts toward the 200 million goal when it lands, after the coin's 3% transfer fee. Donations open after the contract is live.",
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
    a: "Yes. Every collection is held for at least 24 hours before the endowment uses it, and until it's released you can take it back on the Delegate page. Taking one back also switches collection off for your wallet until you switch it back on.",
  },
  {
    q: "Can I leave?",
    a: "Yes, anytime. The Leave button revokes the delegation and removes your landlord record in one step, and revoking works from any Solana wallet without this site or anyone's permission. Anything still being held stays yours to take back.",
  },
  {
    q: "What counts toward 200 million?",
    a: "The $PENIS in the endowment's vault, whether bought or donated. Pledged wallets keep their own $PENIS, so it doesn't count, and neither does $PENIS added to liquidity.",
  },
  {
    q: "Who runs it?",
    a: "The contract sets the rules. Automated keys do the daily work: one counts landlords and posts the reward total, one collects, and a separate one reviews each collection. None of them can send funds anywhere but the vault or back to you. During the founders' test the program can still be upgraded, and every upgrade is announced first. The plan is to destroy the upgrade key after the test, so the rules can't change.",
  },
  {
    q: "When does it open?",
    a: "Pledging opens once the contract is deployed and checked, starting with a founders' test. Collection switches on when pledged wallets hold 30% of all $PENIS, as measured by a daily on-chain count, and stays on unless they fall below 25%. A wallet's $PENIS counts from its second count, once it has been held from one count to the next.",
  },
  {
    q: "Can I check the code?",
    a: "Yes. The contract is open source on GitHub and enforces the limits on this page. The collector and reviewer, which spot which PUMP is a reward, are open source too.",
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
            The $PENIS Endowment turns the PUMP it collects into more $PENIS, and holds it. It is built to be the one
            holder that never pulls out.
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
            Holders pledge the PUMP rewards their $PENIS earns, and keep their $PENIS. The endowment turns that income
            into $PENIS, and its contract has no function to sell it.
          </p>
          <ol className="steps">
            <li>
              <h3>Pledge</h3>
              <p>One signature approves your PUMP account. The contract decides what it can collect: what your $PENIS earned.</p>
            </li>
            <li>
              <h3>Collect and hold</h3>
              <p>Each collection is held for at least 24 hours while a second reviewer checks it. Until it&rsquo;s released, it&rsquo;s yours to take back.</p>
            </li>
            <li>
              <h3>Compound</h3>
              <p>Reviewed collections buy $PENIS in small amounts, and it stays in the vault.</p>
            </li>
          </ol>
        </div>
      </section>

      <section id="donate" className="row">
        <h2 className="row-label">Donations</h2>
        <div className="row-body">
          <h3 className="statement">A one-time gift. A permanent holding.</h3>
          <p>
            Rather pledge nothing ongoing? Soon you&rsquo;ll be able to donate $PENIS straight to the endowment&rsquo;s
            vault in a single transfer.
          </p>
          <ul className="plain-list">
            <li>
              <strong>Straight to the vault</strong>
              <span>Donated $PENIS goes into the endowment&rsquo;s vault, alongside everything it buys.</span>
            </li>
            <li>
              <strong>Counts when it lands</strong>
              <span>It counts toward the 200 million goal when it arrives, after the coin&rsquo;s 3% transfer fee.</span>
            </li>
            <li>
              <strong>Clear before you sign</strong>
              <span>The donation screen will show what you send, what arrives after the fee, and the vault&rsquo;s address.</span>
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
          <h3 className="statement">Its PUMP buys $PENIS.</h3>
          <p>
            The endowment buys in small, spaced-out amounts with the PUMP it holds, each priced against the
            pool&rsquo;s recent average, and pays a 0.25% tip to whoever runs the buy. Nothing is sold.
          </p>
        </div>
      </section>

      <section id="safeguards" className="row">
        <h2 className="row-label">Guarantees</h2>
        <div className="row-body">
          <h3 className="statement">Written into the contract, not promised in a thread.</h3>
          <ul className="plain-list">
            <li>
              <strong>Capped at what your $PENIS earned</strong>
              <span>
                The contract never lets a collection exceed what your $PENIS earned, and never touches the PUMP you held
                when you joined.
              </span>
            </li>
            <li>
              <strong>Held for 24 hours</strong>
              <span>
                Every collection waits at least a day while a second, independent reviewer checks it against the
                payout records and returns what it can&rsquo;t match. Until it&rsquo;s released, you can take it back.
              </span>
            </li>
            <li>
              <strong>Two places only</strong>
              <span>Held PUMP can only go to the endowment&rsquo;s vault or back to you.</span>
            </li>
            <li>
              <strong>No function to sell</strong>
              <span>The contract has no function that can sell or withdraw its $PENIS.</span>
            </li>
            <li>
              <strong>You can always leave</strong>
              <span>Revoke straight from your wallet, anytime, with no permission needed.</span>
            </li>
            <li>
              <strong>Rule changes are announced</strong>
              <span>
                Any change to the limits or the collection keys, or retiring the endowment, waits 72 hours on-chain
                before it takes effect.
              </span>
            </li>
            <li>
              <strong>Upgrades are announced</strong>
              <span>
                During the founders&rsquo; test the program can still be upgraded, and every upgrade is announced first.
                The plan is to then destroy the upgrade key, so the rules can&rsquo;t change.
              </span>
            </li>
            <li>
              <strong>Everything is public</strong>
              <span>
                The <a href={links.github}>source code</a> is open, and every collection and buy is on-chain. Follow{" "}
                <a href={links.x}>@PenisEndowment</a> for updates.
              </span>
            </li>
            <li>
              <strong>Security reviewed</strong>
              <span>
                AI-assisted adversarial reviews: three rounds and a mainnet-fork rehearsal on the original contract, and
                a further review of the 24-hour hold. <Link href="/security">See the reviews</Link>.
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
            Pledging opens once the contract is deployed and checked, starting with a founders&rsquo; test. Follow{" "}
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
