import Link from "next/link";
import { CopyAddress } from "@/components/CopyAddress";
import { EndowmentProgress } from "@/components/EndowmentProgress";
import { DotLogo } from "@/components/Logo";
import { links, PENIS_MINT } from "@/lib/site";
import { loadHolderRewards } from "@/lib/stonk";

// The holder-rewards figures come from stonk.fun's public API; refresh them at most every five minutes.
export const revalidate = 300;

const whole = (n: number) => Math.round(n).toLocaleString("en-US");

const faqs = [
  {
    q: "What is $PENIS?",
    a: "A meme coin on Solana, launched on stonk.fun. A 3% fee on every buy, sell and transfer is paid out to holders in PUMP. It is the oldest joke there is, with the best possible ticker.",
  },
  {
    q: "What is PUMP?",
    a: "The token of pump.fun. It's what $PENIS pays its holders, and what the endowment runs on.",
  },
  {
    q: "How do I earn PUMP?",
    a: "Hold $PENIS in your wallet. Payouts arrive automatically, with nothing to claim, and each holder's share follows how much $PENIS they hold.",
  },
  {
    q: "Do I have to join the endowment?",
    a: "No. Holding $PENIS is all it takes to earn PUMP. The endowment is an extra: holders who want to can pledge their PUMP rewards or donate $PENIS to it.",
  },
  {
    q: "What is the endowment?",
    a: "A contract that turns PUMP rewards into $PENIS and holds it forever. Holders pledge it the PUMP their $PENIS earns, while their $PENIS stays in their wallets. It buys $PENIS in small amounts and never sells. Its goal is 200 million $PENIS, a fifth of the supply.",
  },
  {
    q: "Who is behind this site?",
    a: "Holders. The site and the endowment are independent of the coin's creators, the code is open source, and every endowment action is posted to @PenisEndowment.",
  },
];

export default async function Home() {
  const rewards = await loadHolderRewards();
  return (
    <div className="wrap">
      <section className="hero coin-hero">
        <div className="hero-copy">
          <h1 className="display h1">
            The coin that
            <br />
            <em>pays</em> rent.
          </h1>
          <p className="lede">
            $PENIS is a meme coin on stonk.fun. A 3% fee on every buy, sell and transfer is paid to holders in PUMP. Its
            holders are building an endowment to keep it well-endowed.
          </p>
          <div className="actions">
            <a href={links.stonkfun} className="button button-primary">
              Get $PENIS
            </a>
            <Link href="#endowment" className="button">
              The endowment
            </Link>
          </div>
        </div>
        <DotLogo className="hero-art" label="$PENIS, a temple drawn in dots" />
      </section>

      <EndowmentProgress />

      {rewards && (
        <section className="row">
          <h2 className="row-label">Paid to holders</h2>
          <div className="row-body">
            <div className="figures">
              <div className="figure">
                <span className="figure-value">{whole(rewards.distributed)}</span>
                <span className="figure-label">PUMP paid to $PENIS holders</span>
              </div>
              <div className="figure">
                <span className="figure-value">{whole(rewards.holders)}</span>
                <span className="figure-label">holders paid</span>
              </div>
            </div>
            <p className="muted small">Live from <a href={links.stonkfun}>stonk.fun</a>&rsquo;s public reward totals.</p>
          </div>
        </section>
      )}

      <section className="row" id="participate">
        <h2 className="row-label">The endowment</h2>
        <div className="row-body">
          <h3 className="statement">The holder that can never pull out.</h3>
          <p>
            The $PENIS Endowment turns PUMP rewards into $PENIS and holds it forever. Holders contribute in one of two
            ways, and the contract has no way to sell.
          </p>
          <ol className="steps">
            <li>
              <h3>Pledge your rewards</h3>
              <p>Your $PENIS stays in your wallet. The endowment collects the PUMP it earns, and never more.</p>
            </li>
            <li>
              <h3>Or donate $PENIS</h3>
              <p>Send $PENIS straight to the vault, once. It counts toward the goal the moment it lands.</p>
            </li>
            <li>
              <h3>It compounds</h3>
              <p>Every PUMP buys $PENIS in small amounts. At 200 million, the endowment has reached its goal.</p>
            </li>
          </ol>
          <div className="actions">
            <Link href="/endowment" className="button">
              How the endowment works
            </Link>
            <Link href="/security" className="button">
              Security
            </Link>
          </div>
        </div>
      </section>

      <section id="rent" className="row">
        <h2 className="row-label">How $PENIS pays</h2>
        <div className="row-body">
          <h3 className="statement">Every trade pays rent.</h3>
          <ul className="plain-list">
            <li>
              <strong>A fee on every trade</strong>
              <span>Each $PENIS buy, sell and transfer carries a 3% fee, and that fee goes to holders.</span>
            </li>
            <li>
              <strong>Paid in PUMP</strong>
              <span>stonk.fun pays it out in PUMP, straight to holders&rsquo; wallets, with nothing to claim.</span>
            </li>
            <li>
              <strong>In proportion</strong>
              <span>Each holder&rsquo;s share follows how much $PENIS they hold. More $PENIS, more rent.</span>
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
          <h3 className="statement">$PENIS, on Solana.</h3>
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
              <dt>Rewards</dt>
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
            <a href={links.stonkfun} className="button button-primary">
              Get $PENIS on stonk.fun
            </a>
            <a href={links.x} className="button">
              Follow @PenisEndowment
            </a>
          </div>
          <p className="muted small">Always check the mint address above before you buy.</p>
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
          <p className="muted small">
            Questions about delegating? See the <Link href="/endowment#questions">endowment&rsquo;s questions</Link>.
          </p>
        </div>
      </section>
    </div>
  );
}
