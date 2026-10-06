"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DelegateButton } from "./DelegateButton";
import { DonationButton } from "./DonationButton";
import { COUNT_INTERVAL, goalPercent, percent, progressState, wholeTokens, type Progress } from "@/lib/progress";

const states = {
  loading: ["Checking progress", "Reading the latest totals from the chain."],
  unconfigured: ["Not configured", "Live totals are not configured for this endowment."],
  unavailable: ["Totals unavailable", "The latest totals could not be verified."],
  uncounted: ["First count pending", "No verified participation count is available yet."],
  raising: ["Building to 30%", "Participation activates at 30%. Reward collection also depends on other checks and the collection service."],
  active: ["Participation active", "Participation is active at the last verified count. This does not confirm that reward collection is running."],
  stale: ["Count out of date", "A fresh participation count is required. Reward collection also depends on other checks and a running collection service."],
  paused: ["Paused", "Reward collection is paused. Once the pause ends, the other collection conditions still need to be met. Pledges shown are from the last count."],
  retired: ["Reward collection closed", "The endowment is retired. Direct transfers are separate; vault holdings remain subject to the contract and any retained upgrade authority."],
  complete: ["Goal reached", "The 200 million $PENIS goal has been reached. Reward collection has ended; direct donations are separate."],
} as const;

function Stamp({ unix }: { unix: number }) {
  const iso = new Date(unix * 1000).toISOString();
  return <time dateTime={iso}>{iso.slice(0, 16).replace("T", " ")} UTC</time>;
}

function Meter({ value, max, label, text }: { value: number | null; max: number; label: string; text: string }) {
  return (
    <div className="progress-track" role={value === null ? undefined : "progressbar"}
      aria-label={value === null ? undefined : label} aria-valuemin={value === null ? undefined : 0}
      aria-valuemax={value === null ? undefined : max} aria-valuenow={value === null ? undefined : Math.min(max, value)}
      aria-valuetext={value === null ? undefined : text}>
      <span style={{ width: `${value === null ? 0 : Math.min(100, value / max * 100)}%` }} />
    </div>
  );
}

export function EndowmentProgress({ detailPage = false }: { detailPage?: boolean }) {
  const [data, setData] = useState<Progress | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch("/api/progress", {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
        });
        if (!response.ok) throw new Error("Progress unavailable");
        const result = await response.json() as Progress;
        if (!controller.signal.aborted) { setData(result); setNow(Math.floor(Date.now() / 1000)); }
      } catch {
        if (!controller.signal.aborted) { setData({ kind: "unavailable" }); setNow(Math.floor(Date.now() / 1000)); }
      }
    }
    void refresh();
    const poll = setInterval(() => { if (!document.hidden) void refresh(); }, 60_000);
    const tick = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => { controller.abort(); clearInterval(poll); clearInterval(tick); };
  }, []);
  const state = progressState(data, now);
  const snapshot = data?.kind === "ready" && state !== "unavailable" ? data : null;
  const counted = snapshot && snapshot.lastCountAt > 0;
  const oldCount = counted && now - snapshot.lastCountAt > COUNT_INTERVAL;
  const emphasis = snapshot?.active || state === "complete" ? "vault" : "pledges";
  return (
    <section className="endowment-progress" id="endowment" aria-labelledby="endowment-heading">
      <div className="progress-heading">
        <h2 id="endowment-heading">Help grow the $PENIS Endowment.</h2>
        <span className="progress-state" role="status">{states[state][0]}</span>
      </div>
      <p className="progress-intro">Together, holders are building a reserve of 200 million $PENIS for the long term.</p>
      <div className="progress-grid">
        <article className={`progress-metric ${emphasis === "vault" ? "metric-focus" : ""}`}>
          <div className="metric-heading"><h3>$PENIS in the endowment</h3><span>Goal · 200M</span></div>
          <p className="metric-value">{snapshot ? wholeTokens(snapshot.held) : "—"}<span> / 200,000,000</span></p>
          <Meter value={snapshot ? goalPercent(snapshot.held) : null} max={100} label="Endowment goal"
            text={snapshot ? `${wholeTokens(snapshot.held)} PENIS held toward 200 million` : ""} />
          <p className="metric-note">The $PENIS in the endowment’s vault, bought or donated.</p>
          {snapshot ? <a className="source-link" href={`https://solscan.io/account/${snapshot.vault}`}>View the vault ↗</a> : <span className="source-link muted">{state === "unconfigured" ? "Vault total available after launch" : "No verified vault total"}</span>}
        </article>
        <article className={`progress-metric ${emphasis === "pledges" ? "metric-focus" : ""}`}>
          <div className="metric-heading"><h3>Supply pledging rewards</h3><span>Starts at 30%</span></div>
          <p className="metric-value">{counted ? percent(snapshot.committedBps) : "—"}<span> / 30%</span></p>
          <Meter value={counted ? snapshot.committedBps / 100 : null} max={30} label="Pledged supply"
            text={counted ? `${percent(snapshot.committedBps)} of supply counted toward 30%` : ""} />
          <p className="metric-note">Your $PENIS stays in your wallet. Participation activates at 30%, deactivates below 25%, and needs 30% to reactivate.</p>
          {counted ? <span className="source-link">{oldCount ? "Last count (over 24h old): " : "Counted: "}<Stamp unix={snapshot.lastCountAt} /></span> : <span className="source-link muted">Waiting for a verified participation count</span>}
        </article>
      </div>
      <div className="progress-footer">
        <div className="progress-status"><p>{states[state][1]}</p>
          {snapshot && <p className="small muted">Vault snapshot: <Stamp unix={snapshot.observedAt} /> · <a href={`https://solscan.io/account/${snapshot.config}`}>Contract records ↗</a></p>}
        </div>
        <div className="contribution-actions">
          <div className="actions"><DelegateButton label="Pledge rewards" primary /><DonationButton /></div>
          <div className="contribution-links">
            <Link href={detailPage ? "#how" : "/endowment#how"}>How pledging works ↗</Link>
            <Link href={detailPage ? "#donate" : "/endowment#donate"}>About direct donations ↗</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
