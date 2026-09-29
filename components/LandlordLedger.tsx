"use client";

import { useEffect, useState } from "react";
import type { Ledger } from "@/lib/ledger";
import { formatTokens } from "@/lib/solana";

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/**
 * The public tally from the last on-chain count: every landlord wallet, what it
 * counted for, and its balance when it was read. Renders nothing before launch.
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
  const total = BigInt(ledger.totalCounted);

  return (
    <section className="row" id="ledger">
      <h2 className="row-label">Landlord ledger</h2>
      <div className="row-body">
        <p>
          Count #{ledger.round}: every landlord wallet, what it counted for, and its $PENIS when the contract read it.
          Anyone can check these numbers on-chain.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>Wallet</th>
              <th className="num">Counted</th>
              <th className="num">Held at count</th>
            </tr>
          </thead>
          <tbody>
            {ledger.rows.map((r) => (
              <tr key={r.owner}>
                <td>
                  <a href={`https://solscan.io/account/${r.owner}`} className="mono">
                    {short(r.owner)}
                  </a>
                  {r.flag && <span className="tag">{r.flag}</span>}
                </td>
                <td className="num">{formatTokens(BigInt(r.counted))}</td>
                <td className="num">{formatTokens(BigInt(r.balanceAtCount))}</td>
              </tr>
            ))}
            <tr className="current">
              <td>Total</td>
              <td className="num">{formatTokens(total)}</td>
              <td className="num" />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
