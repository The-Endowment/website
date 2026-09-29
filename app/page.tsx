import Link from "next/link";
import { CopyAddress } from "@/components/CopyAddress";
import { CommitmentBar } from "@/components/CommitmentBar";
import { DotLogo } from "@/components/Logo";
import { links, PENIS_MINT } from "@/lib/site";

const faqs = [
  {
    q: "What is PUMP?",
    a: "The token of pump.fun. Every $PENIS trade pays a fee, and that fee is paid out to every $PENIS holder in PUMP. The endowment runs on that income.",
  },
  {
    q: "Is my wallet safe if I opt in?",
    a: "You delegate one token account: your PUMP. From then on, new PUMP that arrives there goes to the endowment, whatever its source. It can't touch your $PENIS, your SOL, any other token, or the PUMP you held when you joined. Many landlords use a wallet that holds only $PENIS.",
  },
  {
    q: "Can I commit only part of my $PENIS?",
    a: "Yes. Commitment is per wallet: everything in the wallet you delegate counts, and all new PUMP arriving there goes to the endowment. Keep the $PENIS you want to commit in one wallet and the rest in another.",
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
    a: "It's a milestone, not an end. Contributions keep flowing, and from then on part of every buy becomes permanent liquidity in the $PENIS pool that can never be withdrawn.",
  },
  {
    q: "Can I check the code?",
    a: "Yes. The contract is open source on GitHub, and every rule on this page is enforced by it.",
  },
  {
    q: "When does it open?",
    a: "Sweeps switch on once committed landlords hold 30% of all $PENIS, as measured by a daily on-chain count. Coin counts once it has been held across a full count, and every landlord's counted $PENIS is published after each count.",
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
            <Link href="/delegate" className="button">
              Delegate your PUMP
            </Link>
          </div>
        </div>
        <DotLogo className="hero-art" label="The endowment's mark, a temple drawn in dots" />
      </section>
        <section id="how" className="row">
          <h2 className="row-label">How it works</h2>
          <div className="row-body">
            <h3 className="statement">Landlords lend their rent. The endowment keeps the building.</h3>
            <p>
              The largest holders, the landlords, lend the endowment their PUMP rewards. The endowment turns that
              income into $PENIS it can never sell.
            </p>
            <ol className="steps">
              <li>
                <h3>Delegate</h3>
                <p>One transaction gives the endowment access to your PUMP rewards and nothing else.</p>
              </li>
              <li>
                <h3>Sweep</h3>
                <p>When dividends land, the new PUMP moves to the endowment within seconds.</p>
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
              The endowment buys in small amounts on a randomized schedule, with whatever PUMP it holds. Nothing is
              sold, and nothing is spent on anything else.
            </p>
            <div className="figures">
              <div className="figure">
                <span className="figure-value">200,000,000</span>
                <span className="figure-label">$PENIS, the first milestone</span>
              </div>
              <div className="figure">
                <span className="figure-value">20%</span>
                <span className="figure-label">of all $PENIS, held forever</span>
              </div>
            </div>
            <p>
              After the milestone, contributions keep flowing and part of every buy becomes permanent liquidity that
              can never be withdrawn.
            </p>
          </div>
        </section>

        <section className="row">
          <h2 className="row-label">Guarantees</h2>
          <div className="row-body">
            <h3 className="statement">Written into the contract, not promised in a thread.</h3>
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
                <span>Any change to the limits waits 72 hours on-chain before it takes effect.</span>
              </li>
              <li>
                <strong>Locked forever</strong>
                <span>After a public testing period, the upgrade key is destroyed. No one can change the rules.</span>
              </li>
              <li>
                <strong>Everything is public</strong>
                <span>
                  The <a href={links.github}>source code</a> is open, and every action is posted to{" "}
                  <a href={links.x}>@PenisEndowment</a>.
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
            <h3 className="statement">Built, tested, and ready for the landlords.</h3>
            <p>
              Sweeps switch on once committed landlords hold 30% of all $PENIS, starting with the founding landlords.
              Follow <a href={links.x}>@PenisEndowment</a> for the announcement.
            </p>
            <CommitmentBar />
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
