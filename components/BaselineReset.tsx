"use client";

import { useState } from "react";
import { formatTokens } from "@/lib/solana";

export function BaselineReset({ baseline, balance, busy, canSign, onReset }: {
  baseline: bigint; balance: bigint; busy: boolean; canSign: boolean; onReset: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  return <div className="pledge-review">
    <h4>Restart rewards after spending PUMP</h4>
    <p className="small">Your PUMP balance is below your protected starting balance. The current contract cannot collect new rewards until your balance exceeds that floor, or you approve a reset.</p>
    <dl className="facts">
      <div className="fact"><dt>Current protected balance</dt><dd>{formatTokens(baseline)} PUMP</dd></div>
      <div className="fact"><dt>Current wallet balance</dt><dd>{formatTokens(balance)} PUMP</dd></div>
    </dl>
    <p className="small">A reset makes the PUMP you hold when the transaction executes your new protected starting balance. Nothing is transferred. Existing uncollected eligibility is cleared, pending contributions become refund-only, and collection waits for fresh eligibility checks. Rewards already in your wallet are not backfilled.</p>
    <p className="small">Your $PENIS temporarily stops counting toward endowment participation until the next count round includes your wallet. The public participation total may dip during that time; your tokens stay in your wallet.</p>
    <p className="muted small">Your existing PUMP approval stays the same. You confirm one transaction and pay its network fee in SOL. Spending below the new floor can require another reset.</p>
    <label className="consent"><input type="checkbox" checked={agreed} disabled={busy || !canSign}
      onChange={event => setAgreed(event.target.checked)} /><span>I choose to reset my protected balance to my current PUMP holdings and restart collection under the existing fixed-balance rules.</span></label>
    <button type="button" className="button" disabled={!agreed || busy || !canSign} onClick={onReset}>Review balance reset in wallet</button>
  </div>;
}
