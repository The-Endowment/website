"use client";

import { useEffect, useState } from "react";
import { bpsToPercent } from "@/lib/endowment";
import type { Ledger } from "@/lib/ledger";
import { formatTokens } from "@/lib/solana";

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/**
 * The public tally: every landlord wallet, straight from its on-chain record.
 * Renders nothing before launch.
 */
export function LandlordLedger() {
  const [ledger, setLedger] = useState<Ledger | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ledger")
      .then((r) => r.json())
      .then((l: Ledger) => {
        if (!cancelled) setLedger(l);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ledger || !ledger.launched || ledger.rows.length === 0) return null;

  return (
    <section className="row" id="ledger">
      <h2 className="row-label">Landlord ledger</h2>
      <div className="row-body">
        <p>
          Count #{ledger.round}: {formatTokens(BigInt(ledger.totalCounted))} $PENIS committed (
          {bpsToPercent(ledger.committedBps)}% of supply).
          {ledger.inProgress &&
            ` Count #${ledger.inProgress.round} is in progress: ${ledger.inProgress.counted} of ${ledger.inProgress.expected} landlords read so far.`}{" "}
          Each row is the landlord&rsquo;s own on-chain record, which anyone can check.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>Wallet</th>
              <th className="num">Counted</th>
              <th className="num">Recorded $PENIS</th>
              <th className="num">Checks</th>
            </tr>
          </thead>
          <tbody>
            {ledger.rows.map((r) => (
              <tr key={r.owner}>
                <td>
                  <a href={`https://solscan.io/account/${r.owner}`} className="mono">
                    {short(r.owner)}
                  </a>
                </td>
                <td className="num">
                  {r.round > 0 ? formatTokens(BigInt(r.counted)) : "–"}
                  {r.round > 0 && r.round !== ledger.round && <span className="tag">#{r.round}</span>}
                </td>
                <td className="num">{formatTokens(BigInt(r.recorded))}</td>
                <td className="num">
                  {r.checks} of {r.required}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          Counted: what the wallet counted for when it was last read. Recorded: the most its next count can credit, which
          only goes down between counts. Checks: reads by the endowment&rsquo;s refresher since the last count, at
          least 30 minutes apart. A wallet counts once it has {ledger.rows[0]?.required ?? 3}.
        </p>
      </div>
    </section>
  );
}
