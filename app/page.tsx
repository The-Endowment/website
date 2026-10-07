import Link from "next/link";
import { CopyAddress } from "@/components/CopyAddress";
import { EndowmentProgress } from "@/components/EndowmentProgress";
import { DotLogo } from "@/components/Logo";
import { links, PENIS_MINT } from "@/lib/site";
import { loadHolderRewards } from "@/lib/stonk";
import { readPrices, usdFromDollars } from "@/lib/values";

// The holder-rewards figures come from stonk.fun's public API; refresh them at most every five minutes.
export const revalidate = 300;

const whole = (n: number) => Math.round(n).toLocaleString("en-US");

const faqs = [
  {
    q: "What is $PENIS?",
    a: "A meme coin on Solana, launched on stonk.fun. It is the oldest joke there is, with the best possible ticker, and it pays its holders rent.",
  },
  {
    q: "How do I earn PUMP?",
    a: "Hold $PENIS. A 3% fee on every buy, sell and transfer is paid out to holders in PUMP, pump.fun's token, automatically and with nothing to claim. Each holder's share follows how much $PENIS they hold.",
  },
  {
    q: "Do I have to join the endowment?",
    a: "No. Holding $PENIS is all it takes to earn PUMP. The endowment is an extra for holders who want to pledge their rewards.",
  },
  {
    q: "Who is behind this site?",
    a: "Holders. The site and the endowment are independent of the coin's creators, the code is open source, and every endowment action is public on-chain.",
  },
];

export default async function Home() {
  const [rewards, prices] = await Promise.all([loadHolderRewards(), readPrices()]);
  const rewardsUsd = rewards && prices.pumpUsd !== null ? usdFromDollars(rewards.distributed * prices.pumpUsd) : null;
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
            $PENIS is a meme coin on stonk.fun. A 3% fee on every trade is paid to holders in PUMP, and its holders are
            building an endowment to keep it well-endowed.
          </p>
          <div className="actions">
            <a href={links.stonkfun} className="button button-primary">
              Get $PENIS
            </a>
            <Link href="/endowment" className="button">
              The endowment
            </Link>
          </div>
          {rewards && (
            <p className="hero-stat">
              <strong>{whole(rewards.distributed)} PUMP</strong>{rewardsUsd && ` (${rewardsUsd})`} paid to{" "}
              {whole(rewards.holders)} holders so far.
            </p>
          )}
        </div>
        <DotLogo className="hero-art" label="$PENIS, a temple drawn in dots" />
      </section>

      <EndowmentProgress />

      <section className="row">
        <h2 className="row-label">The endowment</h2>
        <div className="row-body">
          <h3 className="statement">The holder that can never pull out.</h3>
          <p>
            Holders pledge the PUMP their $PENIS earns, and the endowment turns it into $PENIS it holds, with no
            function to sell. Your $PENIS stays in your wallet, and you can take any collection back during its 24-hour
            hold.
          </p>
          <div className="actions">
            <Link href="/endowment" className="button">
              How the endowment works
            </Link>
          </div>
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
              <dt>Rent</dt>
              <dd>A 3% fee on every buy, sell and transfer, paid to holders in PUMP in proportion to their $PENIS</dd>
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
            About pledging? See the <Link href="/endowment#questions">endowment&rsquo;s questions</Link>.
          </p>
        </div>
      </section>
    </div>
  );
}
