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
  { q: "What is $PENIS?", a: "A meme coin on Solana, launched on stonk.fun. Transaction fees fund PUMP rewards for eligible holders. The oldest joke there is, with something extra for holding." },
  { q: "What is PUMP?", a: "The token of pump.fun. It is the reward token distributed to eligible $PENIS holders by stonk.fun." },
  { q: "How much will I earn?", a: "There is no fixed return. Rewards depend on trading activity, fees and stonk.fun’s distribution rules. Token prices can also change." },
  { q: "Do I have to join the endowment to hold $PENIS?", a: "No. Holding $PENIS and contributing to the endowment are separate choices. The endowment is an optional, community-funded project." },
  { q: "Does pledging mean giving away my $PENIS?", a: "No. The proposed pledge contributes eligible PUMP rewards while your $PENIS stays in your wallet. Those pledged coins do not count toward the endowment’s 200 million coin goal." },
  { q: "Who is behind this site?", a: "Holders. This site and the endowment are independent of the coin’s creators. The code and proposed endowment changes are public on GitHub." },
];

export default async function Home() {
  const rewards = await loadHolderRewards();
  return (
    <div className="wrap">
      <section className="hero coin-hero">
        <div className="hero-copy">
          <p className="eyebrow">$PENIS · Solana · PUMP rewards</p>
          <h1 className="display h1">
            Hold your PENIS.<br /><em>Earn PUMP.</em>
          </h1>
          <p className="lede">
            A Solana meme coin that pays holders PUMP rewards, funded by transaction fees.
          </p>
          <div className="actions">
            <a href={links.stonkfun} className="button button-primary">
              Get $PENIS
            </a>
            <Link href="#endowment" className="button">
              Explore the endowment
            </Link>
          </div>
          <p className="hero-footnote">Rewards vary with activity. No fixed return.</p>
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
            <p className="muted small">Cumulative rewards reported by <a href={links.stonkfun}>stonk.fun</a>; refreshed about every five minutes.
              These are rewards to holders, separate from the endowment balance.</p>
          </div>
        </section>
      )}

      <section className="row" id="participate">
        <h2 className="row-label">A shared goal</h2>
        <div className="row-body">
          <h3 className="statement">Built by holders. For the long term.</h3>
          <p>The endowment aims to turn voluntary PUMP contributions into a lasting reserve of $PENIS.
            Reaching 200 million coins would put a fifth of the original billion-coin supply in the endowment.</p>
          <ol className="steps">
            <li><h3>Hold</h3><p>Hold $PENIS and receive eligible PUMP rewards in your wallet.</p></li>
            <li><h3>Choose to contribute</h3><p>Once participation opens, review the terms and choose whether to pledge your rewards.</p></li>
            <li><h3>Build together</h3><p>Cleared contributions fund the endowment. Reward collection ends when the vault reaches 200M $PENIS.</p></li>
          </ol>
          <p className="note">Pledged rewards are contributions, not loans. Your $PENIS stays yours.
            Eligibility and the collection safeguards will be shown before you sign.</p>
          <div className="actions"><Link href="/endowment" className="button">Explore the design ↗</Link><Link href="/security" className="button">Review &amp; transparency ↗</Link></div>
        </div>
      </section>

      <section id="rent" className="row">
        <h2 className="row-label">How $PENIS pays</h2>
        <div className="row-body">
          <h3 className="statement">A little extra for holding.</h3>
          <ul className="plain-list">
            <li>
              <strong>A fee on every trade</strong>
              <span>The coin’s 3% transfer fee funds the reward mechanism.</span>
            </li>
            <li>
              <strong>Paid in PUMP</strong>
              <span>stonk.fun distributes PUMP to eligible holders’ wallets.</span>
            </li>
            <li>
              <strong>In proportion</strong>
              <span>Rewards depend on eligible balances and stonk.fun’s distribution rules.</span>
            </li>
          </ul>
        </div>
      </section>

      <section className="band">
        <blockquote>
          A coin for the joke. <span>An endowment for the long run.</span>
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
