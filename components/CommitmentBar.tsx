"use client";

import { useEffect, useState } from "react";
import {
  bpsToPercent,
  decodeConfig,
  decodeRoster,
  fetchDecoded,
  MAX_LANDLORDS,
  rosterPda,
  type EndowmentConfig,
} from "@/lib/endowment";
import { flagshipInstance, readRpc } from "@/lib/solana";

type Data = { config: EndowmentConfig; landlords: number };

/**
 * Committed supply from the endowment's last on-chain count, against the
 * threshold that switches sweeps on. Renders nothing before launch.
 */
export function CommitmentBar() {
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const inst = await flagshipInstance();
      if (!inst) return;
      const rpc = readRpc();
      const [config, roster] = await Promise.all([
        fetchDecoded(rpc, inst.config, decodeConfig),
        fetchDecoded(rpc, await rosterPda(inst.program, inst.config), decodeRoster),
      ]);
      if (!cancelled && config) setData({ config, landlords: roster?.entries.length ?? 0 });
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) return null;
  const { config, landlords } = data;
  const committed = config.lastCountBps;
  const threshold = config.params.activateBps;
  const filled = threshold === 0 ? 100 : Math.min(100, (committed / threshold) * 100);
  const lastCount = Number(config.lastCountAt);

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
        {landlords} of {MAX_LANDLORDS} landlord places filled.
        {lastCount > 0 ? ` Last counted on-chain ${new Date(lastCount * 1000).toLocaleString()}.` : " The first count runs a day after landlords join."}
      </p>
    </div>
  );
}
