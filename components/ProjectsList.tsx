"use client";

import { useEffect, useState } from "react";
import type { EndowmentSummary } from "@/app/api/endowments/route";
import { bpsToPercent } from "@/lib/endowment";
import { formatTokens } from "@/lib/solana";

export function useEndowments() {
  const [list, setList] = useState<EndowmentSummary[] | null>(null);
  useEffect(() => {
    fetch("/api/endowments")
      .then((r) => r.json())
      .then((d: { endowments: EndowmentSummary[] }) => setList(d.endowments))
      .catch(() => setList([]));
  }, []);
  return list;
}

/** What this endowment's keys can still do, in a few words. */
function keys(e: EndowmentSummary) {
  const out: string[] = [];
  if (e.retired) out.push("retired");
  out.push(e.renounced ? "settings frozen" : "admin can change settings (72h notice)");
  if (e.guardian) out.push("can be paused");
  if (e.pendingChange) out.push("change pending");
  if (e.noRefresher) out.push("no refresher");
  else if (e.refresherIsCreator) out.push("creator checks the count");
  return out.join(" · ");
}

export function ProjectsList() {
  const list = useEndowments();
  if (list === null) return <p className="muted">Loading…</p>;
  if (list.length === 0) {
    return <p className="muted">The $PENIS Endowment is the first. Others appear here as projects create theirs.</p>;
  }
  return (
    <table className="table projects-table">
      <thead>
        <tr>
          <th>Coin</th>
          <th className="num">Committed</th>
          <th className="num">Coin held forever</th>
          <th className="num">Sweeps</th>
        </tr>
      </thead>
      <tbody>
        {list.map((e) => (
          <tr key={e.config} className="current">
            <td>
              <a href={`https://solscan.io/account/${e.config}`}>
                {e.symbol ? `$${e.symbol}` : `${e.coinMint.slice(0, 4)}…${e.coinMint.slice(-4)}`}
              </a>
              {e.flagship && <span className="flagship">flagship</span>}
              {e.flagshipLookalike && <span className="tag">not the $PENIS Endowment</span>}
              {!e.flagship && <div className="muted small">{keys(e)}</div>}
            </td>
            <td className="num">
              {bpsToPercent(e.committedBps)}% <span className="muted small">of {bpsToPercent(e.activateBps)}%</span>
            </td>
            <td className="num">{formatTokens(BigInt(e.coinBought))}</td>
            <td className="num">{e.active ? "On" : "Off"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The nav link appears only once three or more endowments exist. */
export function ProjectsNavLink() {
  const list = useEndowments();
  if (!list || list.length < 3) return null;
  return <a href="/projects">Projects</a>;
}
