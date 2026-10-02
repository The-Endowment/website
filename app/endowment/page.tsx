import type { Metadata } from "next";
import Link from "next/link";
import { EndowmentProgress } from "@/components/EndowmentProgress";
import { DelegateButton, DelegationNote } from "@/components/DelegateButton";
import { links } from "@/lib/site";

export const metadata: Metadata = {
  title: "The endowment",
  alternates: { canonical: "/endowment" },
  description: "Explore the community’s plan for a 200 million $PENIS endowment, voluntary reward contributions, and the safeguards under review.",
};

const faqs = [
  { q: "What am I contributing?", a: "The proposed pledge contributes 100% of eligible PUMP rewards from the $PENIS in your participating wallet. Your $PENIS stays in your wallet. Cleared rewards are contributions, not loans and not a claim on the endowment." },
  { q: "Can someone pledge using just my wallet address?", a: "No. Joining requires authorization signed by your wallet. A public address alone does not authorize collection. Pledging is currently closed while the contract and participation flow are finalized." },
  { q: "Does a daily allowance prove which PUMP is a reward?", a: "No. PUMP tokens are interchangeable. A balance or daily allowance alone cannot distinguish rewards from purchases. The collection work under review combines payout evidence, wallet history, contract limits and a refundable holding period. This reduces risk but does not guarantee error-free classification." },
  { q: "Can I leave or get a contribution back?", a: "The proposed flow allows you to stop future collections and reclaim your own pending contributions before they are released. Taking a pending contribution back also switches off collection for your wallet until you enable it again. Once a contribution is cleared and released for spending, that reclaim path ends. The final signing screen must explain these separate actions before pledging opens." },
  { q: "What counts toward 200 million?", a: "Only PENIS actually held in the endowment’s principal vault. Pledged wallet balances, pending PUMP and coins committed to liquidity do not count. Direct PENIS donations received by that vault count, but no donation address is published here before the deployment is verified." },
  { q: "When does collection start and stop?", a: "The plan is to begin once the on-chain participation count reaches 30% of supply, pause below 25%, and resume at 30%. Other consent and safety checks must also pass. Reaching 200 million PENIS in the vault stops further reward collection." },
  { q: "Who operates it?", a: "The design includes collection, review and maintenance roles. Those roles and any remaining administrative or upgrade permissions need to be disclosed for the actual deployment. Renouncing an administrator role is different from removing the program’s upgrade authority; neither removes all operating roles." },
];

export default function Endowment() {
  return (
    <div className="wrap">
      <section className="thesis-head">
        <p className="eyebrow">The $PENIS endowment · In development</p>
        <h1 className="display h1">A well-endowed <em>future.</em></h1>
        <p className="lede">Holders building a lasting reserve of $PENIS, together.
          The goal is 200 million coins. The path starts with voluntary contributions and rules people can inspect.</p>
        <div className="actions"><DelegateButton label="Pledge your rewards" primary /><Link href="#how" className="button">Explore the design</Link></div>
        <DelegationNote />
      </section>
      <EndowmentProgress detailPage />
      <section className="row" id="how">
        <h2 className="row-label">The proposed flow</h2>
        <div className="row-body">
          <h3 className="statement">Keep your coins. Help build the reserve.</h3>
          <ol className="steps">
            <li><h3>Choose to pledge</h3><p>Read the terms and sign with your wallet. Your PENIS remains yours; eligible PUMP rewards support the endowment.</p></li>
            <li><h3>Collect, hold, review</h3><p>Collected PUMP is held separately from spendable funds for at least 24 hours. Pending contributions can be reviewed, refunded or reclaimed.</p></li>
            <li><h3>Release and build</h3><p>Only cleared amounts become spendable for buybacks and liquidity. Unresolved amounts become refund-only when their review window expires.</p></li>
          </ol>
          <p className="note">This describes the collection design under review, not an invitation to grant wallet permissions today.</p>
        </div>
      </section>
      <section className="row" id="safeguards">
        <h2 className="row-label">Safety &amp; transparency</h2>
        <div className="row-body">
          <h3 className="statement">Clear choices. Public records.</h3>
          <ul className="plain-list">
            <li><strong>Voluntary participation</strong><span>Holding $PENIS does not enroll you. Pledging requires a separate wallet authorization.</span></li>
            <li><strong>Evidence before spending</strong><span>Payout evidence and wallet history support collection and review. The daily aggregate check is a sanity check, not proof of an individual wallet’s rewards.</span></li>
            <li><strong>A recovery window</strong><span>The holding design separates pending funds from spendable funds and allows the owner to reclaim before release. Refund and release transactions still need someone to submit them.</span></li>
            <li><strong>An explicit finish line</strong><span>The 200M target uses the actual principal vault balance. Buying coins into a liquidity position does not advance that counter.</span></li>
            <li><strong>Permissions made visible</strong><span>Before launch, publish the program and vault addresses, the deployed code version and the remaining operating and upgrade permissions.</span></li>
          </ul>
          <div className="actions"><Link href="/security" className="button">Review history</Link><a href={links.github} className="button">Read the source ↗</a></div>
        </div>
      </section>
      <section className="row" id="status">
        <h2 className="row-label">Launch status</h2>
        <div className="row-body">
          <h3 className="statement">Built in public. Still under review.</h3>
          <p>The endowment is in development. The final collection rules, wallet controls and deployment details need to be verified before pledging opens.
            This site will publish those details and the participation terms.</p>
          <p>Follow <a href={links.x}>@PenisEndowment</a> for updates, or inspect the <a href={links.github}>open-source work</a>.</p>
        </div>
      </section>
      <section className="row" id="questions">
        <h2 className="row-label">Questions</h2>
        <div className="row-body"><div className="faq">{faqs.map(f => <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)}</div></div>
      </section>
    </div>
  );
}
