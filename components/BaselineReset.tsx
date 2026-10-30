"use client";

import { useState } from "react";
import { formatTokens } from "@/lib/solana";

export function BaselineReset({ baseline, balance, busy, resetting = false, canSign, onReset }: {
  baseline: bigint; balance: bigint; busy: boolean; resetting?: boolean; canSign: boolean; onReset: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  return <section className="pledge-review reset-review" aria-labelledby="balance-reset-title" aria-busy={resetting}>
    <div>
      <p className="reset-eyebrow">Action needed to collect future rewards</p>
      <h4 id="balance-reset-title">Reset your protected PUMP balance</h4>
    </div>
    <p className="small">Your PUMP balance has dropped below its protected balance. Your pledge is still registered, but new rewards must first refill that balance unless you reset it.</p>
    <dl className="facts reset-balances">
      <div className="fact"><dt>Previous protected balance</dt><dd>{formatTokens(baseline)} PUMP</dd></div>
      <div className="fact"><dt>Current PUMP holdings</dt><dd>{formatTokens(balance)} PUMP</dd></div>
    </dl>
    <p className="small">The PUMP you hold when the transaction executes becomes your new protected balance. Your tokens stay in your wallet and your existing PUMP approval stays the same.</p>
    <ul className="reset-effects small">
      <li>Existing uncollected eligibility is cleared. Rewards already in your wallet are not backfilled.</li>
      <li>Any pending contributions become refund-only.</li>
      <li>Your $PENIS temporarily stops counting until a new count round includes your wallet. Collection waits for fresh eligibility checks.</li>
    </ul>
    <label className="consent"><input type="checkbox" checked={agreed} disabled={busy || !canSign}
      onChange={event => setAgreed(event.target.checked)} /><span>I choose this balance reset and understand the changes above.</span></label>
    <div className="reset-confirmation">
      <button type="button" className="button button-primary" disabled={!agreed || busy || !canSign} onClick={onReset}>
        {resetting ? "Confirming balance reset…" : "Review balance reset in wallet"}
      </button>
      <p className="muted small" role={resetting ? "status" : undefined}>{resetting
        ? "Review the request in your wallet if prompted. We will refresh your pledge when the transaction confirms."
        : "One wallet confirmation · SOL network fee. Spending below the new protected balance can require another reset."}</p>
    </div>
  </section>;
}
