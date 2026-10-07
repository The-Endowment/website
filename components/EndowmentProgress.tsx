"use client";

import { useEffect, useState } from "react";
import { DelegateButton } from "./DelegateButton";
import { COUNT_INTERVAL, goalPercent, percent, progressState, wholeTokens, type Progress } from "@/lib/progress";

const states = {
  loading: ["Checking progress", "Reading the latest totals from the chain."],
  unconfigured: ["Opening soon", "Goal: 200 million $PENIS in the vault. Collection switches on when pledged wallets reach 30% of all $PENIS."],
  unavailable: ["Totals unavailable", "Live totals show here again once they can be read from the chain."],
  uncounted: ["First count pending", "Pledged balances appear after the first daily count."],
  raising: ["Building to 30%", "Collection switches on when pledged wallets reach 30% of all $PENIS."],
  active: ["Participation active", "The 30% participation threshold was reached and stays active until pledges fall below 25%. Collection also requires its safety checks and operating services."],
  founders: ["Founders test", "The participation threshold is disabled for testing. Public launch requires a fresh count reaching 30%."],
  stale: ["Count due", "Collection waits for the next daily count."],
  paused: ["Paused", "Collection waits for an explicit restart. Pending contributions remain reclaimable. Pledges shown are from the last count."],
  retired: ["Closed to pledges", "The endowment is no longer taking pledges. Its vault balance stays visible here."],
  complete: ["Goal reached", "200 million $PENIS in the vault. Reward collection has ended."],
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

/** The two live totals: $PENIS in the vault toward 200M, and supply pledged toward 30%. Before
 * launch, one line with the goal; there is nothing to count yet. */
export function EndowmentProgress() {
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
  const heading = (
    <div className="progress-heading">
      <h2 id="endowment-heading">Help grow the $PENIS Endowment.</h2>
      <span className="progress-state" role="status">{states[state][0]}</span>
    </div>
  );
  if (state === "loading" || state === "unconfigured") {
    return (
      <section className="endowment-progress" id="endowment" aria-labelledby="endowment-heading">
        {heading}
        <p className="progress-intro">{states[state][1]}</p>
      </section>
    );
  }
  const snapshot = data?.kind === "ready" && state !== "unavailable" ? data : null;
  const counted = snapshot && snapshot.lastCountAt > 0;
  const oldCount = counted && now - snapshot.lastCountAt > COUNT_INTERVAL;
  const emphasis = snapshot?.active || state === "complete" ? "vault" : "pledges";
  return (
    <section className="endowment-progress" id="endowment" aria-labelledby="endowment-heading">
      {heading}
      <p className="progress-intro">{states[state][1]}</p>
      <div className="progress-grid">
        <article className={`progress-metric ${emphasis === "vault" ? "metric-focus" : ""}`}>
          <h3>$PENIS in the vault, bought or donated</h3>
          <p className="metric-value">{snapshot ? wholeTokens(snapshot.held) : "—"}<span> / 200,000,000</span></p>
          <Meter value={snapshot ? goalPercent(snapshot.held) : null} max={100} label="Endowment goal"
            text={snapshot ? `${wholeTokens(snapshot.held)} PENIS held toward 200 million` : ""} />
          {snapshot
            ? <a className="source-link" href={`https://solscan.io/account/${snapshot.vault}`}>View the vault ↗</a>
            : <span className="source-link muted">No verified vault total</span>}
        </article>
        <article className={`progress-metric ${emphasis === "pledges" ? "metric-focus" : ""}`}>
          <h3>Supply pledged, toward 30%</h3>
          <p className="metric-value">{counted ? percent(snapshot.committedBps) : "—"}<span> / 30%</span></p>
          <Meter value={counted ? snapshot.committedBps / 100 : null} max={30} label="Pledged supply"
            text={counted ? `${percent(snapshot.committedBps)} of supply counted toward 30%` : ""} />
          {counted && <span className="source-link">{oldCount ? "Last count (over 24h old): " : "Counted "}<Stamp unix={snapshot.lastCountAt} /></span>}
        </article>
      </div>
      <div className="actions progress-actions"><DelegateButton label="Pledge rewards" primary /></div>
    </section>
  );
}
