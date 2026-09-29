"use client";

import { useEffect, useState } from "react";
import { bpsToPercent, decodeConfig, fetchDecoded, type EndowmentConfig } from "@/lib/endowment";
import { flagshipInstance, readRpc } from "@/lib/solana";

/**
 * Committed supply from the endowment's last on-chain count, against the
 * threshold that switches sweeps on. Renders nothing before launch.
 */
export function CommitmentBar() {
  const [config, setConfig] = useState<EndowmentConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const inst = await flagshipInstance();
      if (!inst) return;
      const config = await fetchDecoded(readRpc(), inst.config, decodeConfig);
      if (!cancelled && config) setConfig(config);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!config) return null;
  const committed = config.lastCountBps;
  const threshold = config.params.activateBps;
  const filled = threshold === 0 ? 100 : Math.min(100, (committed / threshold) * 100);
  const lastCount = Number(config.lastCountAt);
  const landlords = config.landlordCount;

  return (
    <div className="commitment">
      <div className="commitment-head">
        <span className="figure-value">{bpsToPercent(committed)}%</span>
        <span className="figure-label">
          of supply committed{config.active ? ". Sweeps are on." : ` → sweeps switch on at ${bpsToPercent(threshold)}%`}
        </span>
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
