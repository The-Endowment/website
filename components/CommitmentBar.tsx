"use client";

import { useEffect, useState } from "react";
import { bpsToPercent, decodeConfig, fetchDecoded, type EndowmentConfig } from "@/lib/endowment";
import { flagshipInstance, readRpc } from "@/lib/solana";
import { collectionStatus } from "@/lib/collection-status";

/**
 * Committed supply from the endowment's last on-chain count, against the
 * threshold that switches sweeps on. Renders nothing before launch.
 */
export function CommitmentBar() {
  const [config, setConfig] = useState<EndowmentConfig | null>(null);
  const [readAt, setReadAt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const inst = await flagshipInstance();
      if (!inst) return;
      const config = await fetchDecoded(readRpc(), inst.config, decodeConfig);
      if (!cancelled && config) {
        setConfig(config);
        setReadAt(Math.floor(Date.now() / 1000));
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!config) return null;
  const committed = config.lastCountBps;
  const status = collectionStatus(config, readAt);
  // The bar always measures toward the public 30%, also during the founders' test.
  const threshold = config.params.activateBps || 3000;
  const filled = Math.min(100, (committed / threshold) * 100);
  const lastCount = Number(config.lastCountAt);
  const landlords = config.landlordCount;
  const note = {
    closed: ". The endowment has closed to new pledges.",
    paused: ". Collection is paused.",
    founders: ". Founders' test under way.",
    on: ". Collection is on.",
    "count-due": ". Collection waits for the next daily count.",
    building: ` → collection switches on at ${bpsToPercent(threshold)}%`,
  }[status];

  return (
    <div className="commitment">
      <div className="commitment-head">
        <span className="figure-value">{bpsToPercent(committed)}%</span>
        <span className="figure-label">of supply committed{note}</span>
      </div>
      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(filled)}>
        <span style={{ width: `${filled}%` }} />
      </div>
      <p className="muted small">
        {landlords} {landlords === 1 ? "landlord" : "landlords"}.
        {lastCount > 0
          ? ` Last counted on-chain ${new Date(lastCount * 1000).toLocaleString()}.`
          : " Counts run daily; a landlord's $PENIS counts from its second count."}
      </p>
    </div>
  );
}
