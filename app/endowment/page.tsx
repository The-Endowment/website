import type { Metadata } from "next";
import Link from "next/link";
import { DelegateButton, DelegationNote } from "@/components/DelegateButton";
import { EndowmentProgress } from "@/components/EndowmentProgress";
import { DotLogo } from "@/components/Logo";

export const metadata: Metadata = {
  title: { absolute: "The $PENIS Endowment" },
  alternates: { canonical: "/endowment" },
  description:
    "Permanent capital. Holders pledge their PUMP rewards, and the endowment turns them into $PENIS it holds.",
};

const faqs = [
  {
    q: "What does the endowment collect?",
    a: "The PUMP your $PENIS earns, capped each day at what it earned from stonk.fun's public reward total. The PUMP you held when you joined is never collected, and the collector checks each payout first. If a collection ever does include PUMP you bought (say you spent your rewards and bought PUMP just before it), the reviewer returns it during the 24-hour hold. To pledge only part of your $PENIS, keep the rest in another wallet.",
  },
  {
    q: "Can I donate $PENIS instead?",
    a: "Soon. A donation will send $PENIS straight to the vault in one transfer, with no ongoing permission, and count toward the 200 million goal when it lands, after the coin's 3% transfer fee. Only $PENIS in the vault counts toward the goal; pledged wallets keep their own.",
  },
  {
    q: "Can I take a collection back?",
    a: "Yes. Every collection is held for at least 24 hours, and until it's released you can take it back on the Delegate page. Taking one back also switches collection off for your wallet until you switch it back on.",
  },
  {
    q: "Can I leave?",
    a: "Yes, anytime. Leave revokes the approval and removes your landlord record in one step, revoking also works from any Solana wallet, and anything still being held stays yours to take back. Nobody can pledge your wallet for you: every step needs your signature.",
  },
  {
    q: "Who runs it?",
    a: "The contract sets the rules. Automated keys do the daily work: one counts landlords and posts the reward total, one collects, and a separate one reviews each collection. None can send funds anywhere but the vault or back to you. During the founders' test the program can still be upgraded, with every upgrade announced first; the plan is to then destroy the upgrade key.",
  },
  {
    q: "When does it open?",
    a: "Pledging opens once the contract is deployed and checked, starting with a founders' test. Collection switches on when pledged wallets hold 30% of all $PENIS and stays on unless they fall below 25%. A wallet's $PENIS counts from its second daily count.",
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

      <EndowmentProgress />

      <section id="how" className="row">
        <h2 className="row-label">How it works</h2>
        <div className="row-body">
          <h3 className="statement">Landlords pledge their rent. The endowment keeps the building.</h3>
          <ol className="steps unnumbered">
            <li>
              <h3>Pledge</h3>
              <p>One signature approves your PUMP account. Your $PENIS stays in your wallet.</p>
            </li>
            <li>
              <h3>Collect and hold</h3>
              <p>It collects what your $PENIS earned and holds it at least 24 hours while a reviewer checks it. Until then, it&rsquo;s yours to take back.</p>
            </li>
            <li>
              <h3>Buy and keep</h3>
              <p>Reviewed collections buy $PENIS in small amounts, priced against the pool&rsquo;s recent average. Nothing is sold.</p>
            </li>
          </ol>
          <p className="muted small">Or donate $PENIS straight to the vault in one transfer. Donations open soon.</p>
        </div>
      </section>

      <section id="safeguards" className="row">
        <h2 className="row-label">Guarantees</h2>
        <div className="row-body">
          <h3 className="statement">Written into the contract, not promised in a thread.</h3>
          <ul className="plain-list">
            <li>
              <strong>Capped at what you earned</strong>
              <span>No collection can exceed what your $PENIS earned, or touch the PUMP you held when you joined.</span>
            </li>
            <li>
              <strong>Held for 24 hours</strong>
              <span>A second reviewer checks every collection and returns what it can&rsquo;t match to a payout. Until it&rsquo;s released, you can take it back.</span>
            </li>
            <li>
              <strong>No function to sell</strong>
              <span>The contract can&rsquo;t sell or withdraw its $PENIS, and held PUMP can only go to the vault or back to you.</span>
            </li>
            <li>
              <strong>You can always leave</strong>
              <span>Revoke straight from your wallet, anytime, with no permission needed.</span>
            </li>
            <li>
              <strong>Changes are announced</strong>
              <span>
                Limit and key changes wait 72 hours on-chain. Upgrades during the founders&rsquo; test are announced first,
                and the plan is to then destroy the upgrade key.
              </span>
            </li>
          </ul>
          <p className="muted small">
            The code is open source and went through AI-assisted adversarial reviews. <Link href="/security">See the security page</Link>.
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
