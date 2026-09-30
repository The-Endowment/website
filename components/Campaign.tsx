"use client";

import { useEffect, useState } from "react";
import type { Campaign as CampaignData, CampaignLandlord } from "@/lib/campaign";
import { formatTokens, TOKEN_DECIMALS } from "@/lib/solana";

type Launched = Extract<CampaignData, { launched: true }>;

const ZERO = BigInt(0);
const UNIT = BigInt(10) ** BigInt(TOKEN_DECIMALS);
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;

/** Whole tokens as 12.3M / 4.5B, dropping a trailing ".0". */
function compact(amount: bigint): string {
  const whole = Number(amount / UNIT);
  const [div, suffix] = whole >= 1e9 ? [1e9, "B"] : whole >= 1e6 ? [1e6, "M"] : whole >= 1e3 ? [1e3, "K"] : [1, ""];
  return `${(whole / div).toFixed(div === 1 ? 0 : 1).replace(/\.0$/, "")}${suffix}`;
}

/** a / b as a percentage; 0 when b is 0. */
function ratio(a: bigint, b: bigint): number {
  return b > ZERO ? Number((a * BigInt(1_000_000)) / b) / 10_000 : 0;
}

function ago(unix: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} hr ago`;
  const d = Math.floor(s / 86_400);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

const byDesc = (key: (l: CampaignLandlord) => bigint) => (a: CampaignLandlord, b: CampaignLandlord) => {
  const x = key(a);
  const y = key(b);
  return y > x ? 1 : y < x ? -1 : 0;
};

function Wallet({ owner }: { owner: string }) {
  return (
    <td className="wallet">
      <a href={`https://solscan.io/account/${owner}`}>{short(owner)}</a>
    </td>
  );
}

function Share({ value, bar }: { value: string; bar: number }) {
  return (
    <td className="num">
      <span className="share">
        <span className="minibar">
          <span style={{ width: `${Math.min(100, bar)}%` }} />
        </span>
        <span className="share-value">{value}</span>
      </span>
    </td>
  );
}

type Tick = { at: number; label: string; end?: boolean; note?: string };

function Goal({ big, of, fill, label, max, now, ticks, zero = "0" }: {
  big: string; of: string; fill: number; label: string; max: number; now: number; ticks: Tick[]; zero?: string;
}) {
  return (
    <>
      <div className="goal-figures">
        <span className="big">{big}</span>
        <span className="of">{of}</span>
      </div>
      <div className="track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={now}>
        <div className="fill" style={{ width: `${Math.min(100, Math.max(0, fill))}%` }} />
      </div>
      <div className="ticks" aria-hidden="true">
        <span className="tick start" style={{ left: 0 }}>{zero}</span>
        {ticks.map((t) => (
          <span key={t.at} className={t.end ? "tick end goalmark" : "tick"} style={{ left: `${t.at}%` }}>
            <span>
              {t.label}
              {t.note && <span className="tick-note"> · {t.note}</span>}
            </span>
          </span>
        ))}
      </div>
    </>
  );
}

function Raising({ c }: { c: Launched }) {
  const committed = BigInt(c.committed);
  const supply = BigInt(c.supply);
  const target = (supply * BigInt(c.activateBps)) / BigInt(10_000);
  const toGo = target > committed ? target - committed : ZERO;
  const x = c.activateBps;
  const third = (n: number) => pct(Math.round((x * n) / 3));
  const rows = c.landlords.filter((l) => BigInt(l.counted) > ZERO).sort(byDesc((l) => BigInt(l.counted)));
  const details = [...c.landlords].sort(byDesc((l) => BigInt(l.counted)));

  return (
    <section className="row campaign" id="campaign">
      <h2 className="row-label">The campaign</h2>
      <div className="row-body">
        <h3 className="statement">The endowment switches on at {pct(x)}.</h3>
        <p className="lede">
          Every landlord who delegates moves the bar. When committed wallets hold {pct(x)} of all $PENIS, sweeps and
          buybacks start, and the endowment starts buying $PENIS that is never sold.
        </p>

        <div className="goal">
          <Goal
            big={pct(c.committedBps)}
            of={`of ${pct(x)} committed`}
            fill={x > 0 ? (c.committedBps / x) * 100 : 0}
            label={`Committed supply toward the ${pct(x)} goal`}
            max={x / 100}
            now={c.committedBps / 100}
            zero="0%"
            ticks={[
              { at: 100 / 3, label: third(1) },
              { at: 200 / 3, label: third(2) },
              { at: 100, label: pct(x), note: "switches on", end: true },
            ]}
          />
          <div className="goal-facts">
            <span>
              <b>{c.landlordCount}</b> founding landlord{c.landlordCount === 1 ? "" : "s"}
            </span>
            <span>
              <b>{compact(committed)}</b> $PENIS committed
            </span>
            <span>
              <b>{compact(toGo)}</b> $PENIS to go
            </span>
            <span>{c.lastCountAt > 0 ? `Counted on-chain ${ago(c.lastCountAt)}` : "First count coming soon"}</span>
          </div>
        </div>

        <div className="actions">
          <a className="button button-primary" href="/delegate">
            Become a landlord
          </a>
          <a className="button" href="/delegate#counting">
            How counting works
          </a>
        </div>

        <div className="board-head">
          <h3 className="board-title">Founding landlords</h3>
          <span className="board-sub">Ranked by committed $PENIS, from the latest daily count</span>
        </div>
        {rows.length === 0 ? (
          <p className="muted small">No wallets counted yet. The first landlords show here after their first daily count.</p>
        ) : (
          <div className="table-scroll">
            <table className="board">
              <thead>
                <tr>
                  <th className="rank">#</th>
                  <th>Wallet</th>
                  <th className="num">Committed $PENIS</th>
                  <th className="num">Share of supply</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l, i) => (
                  <tr key={l.owner}>
                    <td className="rank">{i + 1}</td>
                    <Wallet owner={l.owner} />
                    <td className="num">{formatTokens(BigInt(l.counted))}</td>
                    <Share value={`${ratio(BigInt(l.counted), supply).toFixed(2)}%`} bar={ratio(BigInt(l.counted), committed)} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {details.length > 0 && (
          <details className="count-details">
            <summary>Count details for every wallet</summary>
            <div className="table-scroll">
              <table className="board">
                <thead>
                  <tr>
                    <th>Wallet</th>
                    <th className="num">Counted</th>
                    <th className="num">Recorded</th>
                    <th className="num">Refresher checks</th>
                  </tr>
                </thead>
                <tbody>
                  {details.map((l) => (
                    <tr key={l.owner}>
                      <Wallet owner={l.owner} />
                      <td className="num">{l.countedRound > 0 ? formatTokens(BigInt(l.counted)) : "–"}</td>
                      <td className="num">{formatTokens(BigInt(l.recorded))}</td>
                      <td className="num">
                        {l.checks} of {l.required}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small">
              Counted is what each wallet counted for at the last daily count. Recorded is the most its next count can
              credit. Refresher checks are reads at least 30 minutes apart since the last count; a wallet counts once it
              has {details[0].required}. New or added $PENIS counts from the following day.
            </p>
          </details>
        )}
      </div>
    </section>
  );
}

const TOP = 6;

function Live({ c }: { c: Launched }) {
  const [all, setAll] = useState(false);
  const bought = BigInt(c.totalBought);
  const spent = BigInt(c.totalSpent);
  const swept = BigInt(c.totalSwept);
  const cap = BigInt(c.milestone);
  const quarter = (n: number) => compact((cap * BigInt(n)) / BigInt(4));
  const board = c.landlords.filter((l) => BigInt(l.contributed) > ZERO).sort(byDesc((l) => BigInt(l.contributed)));
  const shown = all ? board : board.slice(0, TOP);

  return (
    <section className="row campaign" id="campaign">
      <h2 className="row-label">The endowment</h2>
      <div className="row-body">
        <span className="badge">Live</span>
        <h3 className="statement">Rent in, $PENIS locked away.</h3>
        <p className="lede">
          Landlords crossed {pct(c.activateBps)} and the endowment switched on. Every PUMP they delegate now buys
          $PENIS in small amounts through the day, and none of it is ever sold.
        </p>

        <div className="goal">
          {cap > ZERO ? (
            <Goal
              big={compact(bought)}
              of={`of ${compact(cap)} $PENIS bought and locked`}
              fill={ratio(bought, cap)}
              label={`$PENIS bought toward the ${compact(cap)} milestone`}
              max={Number(cap / UNIT)}
              now={Number(bought / UNIT)}
              ticks={[
                { at: 25, label: quarter(1) },
                { at: 50, label: quarter(2) },
                { at: 75, label: quarter(3) },
                { at: 100, label: compact(cap), note: "milestone", end: true },
              ]}
            />
          ) : (
            <div className="goal-figures">
              <span className="big">{compact(bought)}</span>
              <span className="of">$PENIS bought and locked</span>
            </div>
          )}
          <div className="goal-facts">
            <span>
              <b>{pct(c.committedBps)}</b> of supply committed
            </span>
            <span>
              <b>{c.landlordCount}</b> landlord{c.landlordCount === 1 ? "" : "s"}
            </span>
            <span>
              <b>{formatTokens(swept)}</b> PUMP swept
            </span>
            <span>
              <b>{c.buysLastDay}</b> buy{c.buysLastDay === 1 ? "" : "s"} in the last 24h
            </span>
          </div>
        </div>

        <div className="board-head">
          <h3 className="board-title">Landlord leaderboard</h3>
          <span className="board-sub">Ranked by PUMP contributed since launch</span>
        </div>
        {board.length === 0 ? (
          <p className="muted small">No PUMP swept yet. Landlords show here after their first sweep.</p>
        ) : (
          <>
            <div className="table-scroll">
              <table className="board">
                <thead>
                  <tr>
                    <th className="rank">#</th>
                    <th>Wallet</th>
                    <th className="num">PUMP contributed</th>
                    <th className="num">≈ $PENIS it bought</th>
                    <th className="num">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((l, i) => {
                    const contributed = BigInt(l.contributed);
                    const share = ratio(contributed, swept);
                    return (
                      <tr key={l.owner}>
                        <td className="rank">{i + 1}</td>
                        <Wallet owner={l.owner} />
                        <td className="num">{formatTokens(contributed)}</td>
                        <td className="num">{spent > ZERO ? formatTokens((contributed * bought) / spent) : "–"}</td>
                        <Share value={`${share.toFixed(1)}%`} bar={share} />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {board.length > TOP && (
              <p className="small muted">
                {all ? `Showing all ${board.length} landlords. ` : `Showing ${TOP} of ${board.length} landlords. `}
                <button type="button" className="link-button" onClick={() => setAll(!all)}>
                  {all ? "Show fewer" : "See all"}
                </button>
              </p>
            )}
          </>
        )}

        {c.buys.length > 0 && (
          <>
            <div className="board-head">
              <h3 className="board-title">Latest buys</h3>
              <span className="board-sub">Each one links to the transaction</span>
            </div>
            <div className="buys">
              {c.buys.map((b) => (
                <div className="buy" key={b.signature}>
                  <time dateTime={new Date(b.time * 1000).toISOString()}>{ago(b.time)}</time>
                  <span>
                    {formatTokens(BigInt(b.pumpIn))} PUMP<span className="arrow">→</span>
                    {formatTokens(BigInt(b.penisOut))} $PENIS
                  </span>
                  <a href={`https://solscan.io/tx/${b.signature}`}>{short(b.signature)}</a>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * The home page campaign: raising toward the switch-on threshold, then (once
 * live) buying toward the milestone. Renders nothing before launch.
 */
export function Campaign() {
  const [data, setData] = useState<CampaignData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/campaign")
      .then((r) => r.json())
      .then((d: CampaignData) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data || !data.launched) return null;
  return data.stage === "live" ? <Live c={data} /> : <Raising c={data} />;
}
