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
    a: "Eligible PUMP rewards from $PENIS. The current contract protects your starting balance and limits collections using posted reward totals; the collector checks payout history first. A reviewer can return mistakes before release, and you can reclaim pending collections yourself. Checks can fail, and released contributions cannot be refunded by this contract. To pledge only part of your $PENIS, keep the rest in another wallet.",
  },
  {
    q: "Can I donate $PENIS instead?",
    a: "Soon. A donation will send $PENIS straight to the vault in one transfer, with no ongoing permission, and count toward the 200 million goal when it lands, after the coin's 3% transfer fee. Only $PENIS in the vault counts toward the goal; pledged wallets keep their own.",
  },
  {
    q: "Can I take a collection back?",
    a: "Yes. Every collection is held for at least 24 hours, and until it's released you can take it back on the Delegate page. Reclaiming a receipt from your current pledge disables it; reclaiming an older pledge's receipt leaves a newer pledge unchanged.",
  },
  {
    q: "Can I leave?",
    a: "Yes, anytime. Leave revokes the approval and removes your landlord record in one step, revoking also works from any Solana wallet, and anything still being held stays yours to take back. Nobody can pledge your wallet for you: every step needs your signature.",
  },
  {
    q: "Who runs it?",
    a: "Automated keys count landlords and post reward totals, collect contributions, and separately review them. The current contract restricts contribution destinations to the vault or the original holder. While upgrade authority exists, that code can change. Removing upgrade authority is a separate decision after testing and review; emergency controls and operator replacement remain separate powers.",
  },
  {
    q: "When does it open?",
    a: "Pledging opens once the contract is deployed and checked, starting with an identified founders' test. Public participation activates at 30% and deactivates below 25%; collection also needs current counts, safety checks and operating services. A wallet's $PENIS counts from its second daily count.",
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
          <h2 className="row-label">Safeguards</h2>
        <div className="row-body">
          <h3 className="statement">Protections in the current contract.</h3>
          <ul className="plain-list">
            <li>
              <strong>A mandatory reward allowance</strong>
              <span>Collection is limited by posted reward totals and your protected starting balance. Payout checks separately identify eligible rewards.</span>
            </li>
            <li>
              <strong>Held for 24 hours</strong>
              <span>A separate reviewer checks collections before release. Until release, you can take yours back; afterward this contract cannot refund it.</span>
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
                Parameter and collection-operator changes wait 72 hours. Program upgrades are a separate power and
                need their own controls while that authority remains.
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
