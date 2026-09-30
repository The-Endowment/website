"use client";

import { useEffect, useState } from "react";
import { fetchMaybeToken } from "@solana-program/token-2022";
import { ata, authorityPda, bpsToPercent, decodeConfig, fetchDecoded, type EndowmentConfig } from "@/lib/endowment";
import { flagshipInstance, readRpc } from "@/lib/solana";
import { fundingState, fundingStatus } from "@/lib/funding-state";

/**
 * Committed supply from the endowment's last on-chain count, against the
 * threshold that switches sweeps on. Renders nothing before launch.
 */
export function CommitmentBar() {
  const [snapshot, setSnapshot] = useState<{ config: EndowmentConfig; balance: bigint | null } | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const inst = await flagshipInstance();
      if (!inst) return;
      const rpc = readRpc();
      const config = await fetchDecoded(rpc, inst.config, decodeConfig);
      const authority = await authorityPda(inst.program, inst.config);
      const vault = await fetchMaybeToken(rpc, await ata(authority, inst.coinMint, inst.coinTokenProgram));
      if (!cancelled && config) setSnapshot({ config, balance: vault.exists ? vault.data.amount : null });
    };
    const tick = () => {
      setNow(Math.floor(Date.now() / 1000));
      refresh().catch(() => { if (!cancelled) setSnapshot(null); });
    };
    tick();
    const timer = setInterval(tick, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!snapshot) return null;
  const { config, balance } = snapshot;
  const state = fundingState(config, balance, now);
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
          of supply committed. {fundingStatus[state]}
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
