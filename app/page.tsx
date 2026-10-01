import Link from "next/link";
import { CopyAddress } from "@/components/CopyAddress";
import { Campaign } from "@/components/Campaign";
import { DotLogo } from "@/components/Logo";
import { links, PENIS_MINT } from "@/lib/site";

const faqs = [
  {
    q: "What is PUMP?",
    a: "The token of pump.fun. Every $PENIS trade pays a fee, and that fee is paid out to every $PENIS holder in PUMP. The endowment runs on that income.",
  },
  {
    q: "Is my wallet safe if I opt in?",
    a: "The draft collects verified future PENIS rewards paid in PUMP, then holds each collection for at least 24 hours before review and release. Your wallet grants a broad PUMP approval: trusted services identify rewards, and mistakes remain possible. You can reclaim pending funds before release. Your PENIS is not delegated. See the security page for the remaining risks.",
  },
  {
    q: "Can I commit only part of my $PENIS?",
    a: "Commitment covers the PENIS in the registered wallet's token account and its eligible future PUMP rewards. To commit only part of your holdings, keep the rest in another wallet. Purchases and other coins' rewards are excluded by the proposed worker policy.",
  },
  {
    q: "Can I leave?",
    a: "Yes. Stop collection revokes the token approval and disables collection consent when those permissions are available. You can also revoke through your wallet without this site. Pending contributions remain reclaimable until release; released contributions are permanent.",
  },
  {
    q: "Who runs it?",
    a: "The proposal uses a collector, an independent reviewer and a keeper. The contract restricts their actions, but their evidence and the retained program upgrade authority remain trust assumptions. Role custody and any future removal of upgrade authority must be agreed before launch.",
  },
  {
    q: "What happens at 200 million?",
    a: "New collections stop once the permanent treasury holds 200 million PENIS, including direct donations. Liquidity holdings do not count. Remaining pending contributions become refundable; already released treasury funds and future treasury rewards continue funding buybacks and permanent liquidity.",
  },
  {
    q: "Can I check the code?",
    a: "Yes. The contract and website are open source on GitHub. The security page distinguishes contract-enforced custody rules from trusted off-chain reward classification. The latest changes are drafts awaiting review.",
  },
  {
    q: "When does it open?",
    a: "Enrollment and collection are closed pending review and a test deployment. After launch, collection requires the 30% commitment threshold; it pauses below 25% and resumes at 30%. Holdings and enabled consent are checked through the contract's sampled counting process.",
  },
];

export default function Home() {
  return (
    <>
      <div className="wrap">
      <section className="hero">
        <div className="hero-copy">
          <h1 className="display h1">
            Permanent capital.
            <br />
            <em>Firm</em> commitments.
          </h1>
          <p className="lede">
            The $PENIS Endowment turns every PUMP it earns into more $PENIS, and holds it forever. It is the one
            holder that can never pull out.
          </p>
          <div className="actions">
            <Link href="#how" className="button button-primary">
              How it works
            </Link>
            <Link href="/contributions" className="button">
              Review contributions
            </Link>
          </div>
        </div>
        <DotLogo className="hero-art" label="The endowment's mark, a temple drawn in dots" />
      </section>
        <Campaign />
        <section id="how" className="row">
          <h2 className="row-label">How it works</h2>
          <div className="row-body">
            <h3 className="statement">Landlords contribute their rent. The endowment keeps the building.</h3>
            <p>
              Holders can pledge eligible PUMP rewards. After a holding period and review, released contributions
              fund permanent PENIS holdings and liquidity. This collection system is still a draft.
            </p>
            <ol className="steps">
              <li>
                <h3>Consent</h3>
                <p>Review the pledge and sign with your wallet. PENIS stays with you; PUMP approval can be revoked.</p>
              </li>
              <li>
                <h3>Collect and hold</h3>
                <p>Verified rewards enter holding custody. Each collection stays reclaimable for at least 24 hours, until release.</p>
              </li>
              <li>
                <h3>Compound</h3>
                <p>Only reviewed amounts enter the spendable treasury. Incorrect or unresolved collections return to their holder.</p>
              </li>
            </ol>
          </div>
        </section>

        <section className="row">
          <h2 className="row-label">How it spends</h2>
          <div className="row-body">
            <h3 className="statement">Every PUMP buys $PENIS.</h3>
            <p>
              The endowment buys in small, spaced-out amounts with spendable treasury PUMP, each priced against the
              pool&rsquo;s recent average. Nothing is sold, and nothing is spent on anything else.
            </p>
            <div className="figures">
              <div className="figure">
                <span className="figure-value">200,000,000</span>
                <span className="figure-label">$PENIS held directly, the funding goal</span>
              </div>
              <div className="figure">
                <span className="figure-value">20%</span>
                <span className="figure-label">of all $PENIS, held forever</span>
              </div>
            </div>
            <p>
              At the goal, holder contributions stop permanently. Existing treasury funds and future treasury rewards
              continue buying $PENIS and adding permanent liquidity. Coins in liquidity pools do not count toward the goal.
            </p>
          </div>
        </section>

        <section className="row">
          <h2 className="row-label">Safeguards</h2>
          <div className="row-body">
            <h3 className="statement">Restricted custody, with trust assumptions made public.</h3>
            <ul className="plain-list">
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
                <span>Admin parameter changes and retirement wait 72 hours. The separate program upgrade authority remains a trust assumption.</span>
              </li>
              <li>
                <strong>Upgrade policy unresolved</strong>
                <span>The draft has no discretionary principal withdrawal. Any decision to remove upgrade authority still needs review.</span>
              </li>
              <li>
                <strong>Everything is public</strong>
                <span>
                  The <a href={links.github}>source code</a> and on-chain transactions are public. Off-chain payout evidence must also be retained for review.
                </span>
              </li>
              <li>
                <strong>Review before launch</strong>
                <span>
                  This draft has automated tests and needs an independent review and test deployment.{" "}
                  <Link href="/security">See the safeguards and limitations</Link>.
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

        <section id="coin" className="row">
          <h2 className="row-label">The coin</h2>
          <div className="row-body">
            <h3 className="statement">$PENIS pays rent in PUMP.</h3>
            <p>
              $PENIS is a meme coin on Solana, launched on stonk.fun. Every trade pays a fee, and holders receive it as
              PUMP. It is the oldest joke there is with the best possible ticker, and a penis that pays you in PUMP.
            </p>
            <dl className="facts">
              <div className="fact">
                <dt>Mint address</dt>
                <dd>
                  <CopyAddress address={PENIS_MINT} />
                </dd>
              </div>
              <div className="fact">
                <dt>Supply</dt>
                <dd>About 1 billion. Minting and freezing are permanently disabled.</dd>
              </div>
              <div className="fact">
                <dt>Dividends</dt>
                <dd>A 3% fee on every transfer, paid to holders in PUMP</dd>
              </div>
              <div className="fact">
                <dt>Main market</dt>
                <dd>
                  PENIS/PUMP on Raydium. <a href={links.dexscreener}>Chart</a>, <a href={links.solscan}>Solscan</a>
                </dd>
              </div>
            </dl>
            <div className="actions">
              <a href={links.stonkfun} className="button">
                $PENIS on stonk.fun
              </a>
            </div>
          </div>
        </section>

        <section id="status" className="row">
          <h2 className="row-label">Status</h2>
          <div className="row-body">
            <h3 className="statement">A draft for review.</h3>
            <p>
              Enrollment and collection remain closed while the refundable collection design is reviewed.
              Follow <a href={links.x}>@PenisEndowment</a> for the announcement.
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
    </>
  );
}
