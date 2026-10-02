"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DelegateButton, DelegationNote } from "./DelegateButton";
import { COUNT_INTERVAL, goalPercent, percent, progressState, wholeTokens, type Progress } from "@/lib/progress";

const states = {
  loading: ["Checking progress", "Reading the latest public snapshot."],
  unconfigured: ["Not open yet", "The endowment is in development. Live totals appear after the deployment is verified."],
  unavailable: ["Data unavailable", "We couldn’t verify a recent snapshot. Totals are hidden until the data is available again."],
  uncounted: ["Awaiting first count", "Pledged balances appear after the first completed on-chain count."],
  raising: ["Building commitment", "Collection awaits the 30% activation threshold and the contract’s other safety checks."],
  active: ["Participation gate open", "The latest count enables participation. Collection still depends on consent and the other safety checks."],
  stale: ["Count needs refresh", "The last participation count is too old to authorize collection."],
  paused: ["Paused", "The contract’s pause is in effect. Displayed pledges are from the last completed count."],
  retired: ["Closed to contributions", "The endowment is retired. Its vault balance remains visible here."],
  complete: ["Goal reached", "The contribution goal has been reached. Further reward collection is disabled."],
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
        <div><p className="eyebrow">Built by holders</p><h2 id="endowment-heading">A well-endowed future.</h2></div>
        <span className="status-pill" role="status">{states[state][0]}</span>
      </div>
      <p className="progress-intro">A community-funded endowment with one goal: hold 200 million $PENIS for the long term.</p>
      <div className="progress-grid">
        <article className={`progress-metric ${emphasis === "vault" ? "metric-focus" : ""}`}>
          <div className="metric-heading"><h3>$PENIS in the endowment</h3><span>Goal · 200M</span></div>
          <p className="metric-value">{snapshot ? wholeTokens(snapshot.held) : "—"}<span> / 200,000,000</span></p>
          <Meter value={snapshot ? goalPercent(snapshot.held) : null} max={100} label="Endowment goal"
            text={snapshot ? `${wholeTokens(snapshot.held)} PENIS held toward 200 million` : ""} />
          <p className="metric-note">Only $PENIS held in the endowment vault counts. Pledged coins and liquidity positions are excluded.</p>
          {snapshot ? <a className="source-link" href={`https://solscan.io/account/${snapshot.vault}`}>View the vault ↗</a> : <span className="source-link muted">{state === "unconfigured" ? "Vault total available after launch" : "No verified vault total"}</span>}
        </article>
        <article className={`progress-metric ${emphasis === "pledges" ? "metric-focus" : ""}`}>
          <div className="metric-heading"><h3>Supply pledging rewards</h3><span>Starts at 30%</span></div>
          <p className="metric-value">{counted ? percent(snapshot.committedBps) : "—"}<span> / 30%</span></p>
          <Meter value={counted ? snapshot.committedBps / 100 : null} max={30} label="Pledged supply"
            text={counted ? `${percent(snapshot.committedBps)} of supply counted toward 30%` : ""} />
          <p className="metric-note">Your $PENIS stays in your wallet. Collection starts at 30%, pauses below 25%, and resumes at 30%.</p>
          {counted ? <span className="source-link">{oldCount ? "Last count (over 24h old): " : "Counted: "}<Stamp unix={snapshot.lastCountAt} /></span> : <span className="source-link muted">Waiting for a verified participation count</span>}
        </article>
      </div>
      <div className="progress-footer">
        <div className="progress-status"><p>{states[state][1]}</p>
          {snapshot && <p className="small muted">Vault snapshot: <Stamp unix={snapshot.observedAt} /> · <a href={`https://solscan.io/account/${snapshot.config}`}>Contract records ↗</a></p>}
        </div>
        <div className="actions"><DelegateButton label="Pledge your rewards" primary /><Link href={detailPage ? "#how" : "/endowment"} className="button">How it works ↗</Link></div>
      </div>
      <DelegationNote />
    </section>
  );
}
