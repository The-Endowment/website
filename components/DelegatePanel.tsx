"use client";

import { type Address, type Instruction, type TransactionSigner } from "@solana/kit";
import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useWallets,
  WalletReadyGate,
} from "@solana/kit-plugin-wallet/react";
import { useAction } from "@solana/react";
import {
  getApproveCheckedInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { useEffect, useState } from "react";
import { client, WALLET_CAPTURE_ONLY } from "@/components/WalletClient";
import {
  authorityPda,
  bpsToPercent,
  deregisterLandlordIx,
  registerLandlordIx,
  resyncBaselineIx,
  type Instance,
} from "@/lib/endowment";
import { consentIx, settleIx } from "@/lib/holding/client";
import type { Receipt } from "@/lib/holding/types";
import { loadHolding, type Holding } from "@/lib/holding/wallet";
import { HeldCollections } from "@/components/HeldCollections";
import { loadDelegationStatus, revokeEndowmentApprovalIx, type DelegationStatus } from "@/lib/holding/delegation";
import { flagshipInstance, formatTokens } from "@/lib/solana";
import { DELEGATION_CLOSED_NOTE, DELEGATION_OPEN, links } from "@/lib/site";
import { PledgeSteps, WalletOnboarding } from "@/components/WalletOnboarding";
import { enrollmentWalletIssue, wasWalletDeclined, wasTransactionExpired } from "@/lib/wallet-onboarding";

// Show only error names and numeric codes, never provider URLs or raw payloads.
function actionDiagnostic(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  for (let current = error; current && typeof current === "object" && !seen.has(current) && parts.length < 8;) {
    seen.add(current);
    const value = current as { name?: unknown; code?: unknown; context?: { __code?: unknown }; cause?: unknown };
    const name = typeof value.name === "string" && /^[A-Za-z]{1,60}$/.test(value.name) ? value.name : "Error";
    const code = value.context?.__code ?? value.code;
    parts.push(name + (typeof code === "number" && Number.isFinite(code) ? ` (${code})` : ""));
    current = value.cause;
  }
  return parts.join(" → ") || "Error details unavailable";
}

/**
 * The delegation is unlimited on purpose. The program counts a landlord, and
 * lets them register, only while at least half of u64::MAX is still approved
 * (`MIN_DELEGATION`), so a bounded approval would silently stop counting once
 * rewards used it up. Collection is constrained by the contract's baseline,
 * allowance and receipt rules, with funds entering refundable holding first.
 * Payout origin is checked off-chain; the approval itself proves no provenance.
 * We use ApproveChecked so the wallet shows the token and decimals being approved.
 */
const UNLIMITED = BigInt("18446744073709551615");

/** Why opting in isn't possible right now, in plain words; null if it is. */
function blocker(s: DelegationStatus, holding: Holding | null): string | null {
  if (!DELEGATION_OPEN) return "New pledges and re-enrollment are currently closed. You can still leave or reclaim pending contributions.";
  if (s.config.retired || s.config.milestoneReached) return "The endowment has closed to new landlords.";
  if (!holding?.ready) return "Joining opens as soon as collection is switched on.";
  if (s.now < Number(s.config.pausedUntil)) {
    return "Joining is paused until an explicit restart. You can still leave or reclaim pending contributions.";
  }
  if (s.coinBalance < s.minStake) {
    return `Landlords hold at least ${formatTokens(s.minStake)} $PENIS (${bpsToPercent(s.config.params.minStakeBps)}% of supply). This wallet holds ${formatTokens(s.coinBalance)}.`;
  }
  return null;
}

function Connected({ inst, owner, expectedOwner, canSign }: { inst: Instance; owner: Address; expectedOwner: string | null; canSign: boolean }) {
  const { dispatch: disconnect } = useDisconnect(client);
  const [status, setStatus] = useState<DelegationStatus | null>(null);
  const [holding, setHolding] = useState<Holding | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [holdingError, setHoldingError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [reload, setReload] = useState(0);
  const [lastSignature, setLastSignature] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const walletIssue = enrollmentWalletIssue(owner, expectedOwner);
  const refresh = () => {
    setAgreed(false);
    setStatus(null); setHolding(null); setLoadError(null); setHoldingError(null);
    setReload(n => n + 1);
  };
  useEffect(() => {
    let current = true;
    // Receipt recovery must not depend on balances, mint reads, or enrollment.
    loadDelegationStatus(client.rpc, inst, owner).then(value => {
      if (current) setStatus(value);
    }).catch(() => {
      if (current) setLoadError("Couldn't load the balance dashboard. Recovery controls below are still available.");
    });
    loadHolding(client.rpc, inst, owner).then(value => {
      if (current) setHolding(value);
    }).catch(() => {
      if (current) setHoldingError("Couldn't load held contributions. This does not mean there are none.");
    });
    return () => { current = false; };
  }, [inst, owner, reload]);

  const perform = async (signal: AbortSignal, build: (signer: TransactionSigner) => Promise<Instruction[]>) => {
    setActionError(null); setLastSignature(null);
    let walletFlowStarted = false;
    try {
      if (!canSign) throw new Error("This wallet connection cannot sign the required transaction. Connect a wallet with signing enabled.");
      const signer = client.identity;
      if (signer.address !== owner) throw new Error("Your connected wallet changed. Reconnect and try again.");
      const instructions = await build(signer);
      if (client.identity.address !== owner) throw new Error("Your connected wallet changed. Reconnect and try again.");
      walletFlowStarted = true;
      const result = await client.sendTransaction(instructions, { abortSignal: signal });
      setLastSignature(result.context.signature);
      setAgreed(false);
      refresh();
      return result.context.signature;
    } catch (e) {
      if (wasTransactionExpired(e)) refresh();
      setActionError(WALLET_CAPTURE_ONLY ? "Diagnostic mode stopped before signing. If capture succeeded, use Download unsigned request above. No transaction was submitted."
        : wasTransactionExpired(e) ? "The transaction expired before confirmation. Refreshing your on-chain status; review the updated pledge before requesting a fresh wallet approval. Nothing will retry automatically."
        : wasWalletDeclined(e) ? "The wallet request was declined. If your wallet showed a security warning, close the request and review the permission before trying again."
        : walletFlowStarted ? "The wallet or transaction step failed. Submission status is unknown; check wallet activity and refresh before retrying."
        : e instanceof Error ? e.message : "Couldn't prepare the action. Please try again.");
      throw e;
    }
  };

  const optIn = useAction((signal: AbortSignal) => perform(signal, async signer => {
    if (walletIssue) throw new Error(walletIssue);
    if (!status || !holding || !agreed || blocker(status, holding)) throw new Error("Joining is unavailable. Refresh and review the pledge before signing.");
    const [freshStatus, freshHolding] = await Promise.all([
      loadDelegationStatus(client.rpc, inst, owner), loadHolding(client.rpc, inst, owner),
    ]).catch(() => { throw new Error("Could not verify your current enrollment. Refresh before trying again."); });
    if (signal.aborted) throw new Error("Enrollment request cancelled.");
    setStatus(freshStatus); setHolding(freshHolding);
    if (freshStatus.landlord && freshStatus.delegatedToEndowment && freshHolding.consent?.enabled) {
      setAgreed(false);
      throw new Error("Your pledge is already registered. No new approval was requested.");
    }
    const freshBlocker = blocker(freshStatus, freshHolding);
    if (freshBlocker) throw new Error(freshBlocker);
    const authority = await authorityPda(inst.program, inst.config);
    const ixs: Instruction[] = [
      getCreateAssociatedTokenIdempotentInstruction({
        payer: signer,
        owner: signer.address,
        mint: inst.dividendMint,
        ata: freshStatus.dividendAccount,
        tokenProgram: inst.dividendTokenProgram,
      }),
      // Registering needs the coin account to exist, even while it's empty (audit L-12).
      getCreateAssociatedTokenIdempotentInstruction({
        payer: signer,
        owner: signer.address,
        mint: inst.coinMint,
        ata: freshStatus.coinAccount,
        tokenProgram: inst.coinTokenProgram,
      }),
      getApproveCheckedInstruction(
        {
          source: freshStatus.dividendAccount,
          mint: inst.dividendMint,
          delegate: authority,
          owner: signer,
          amount: UNLIMITED,
          decimals: freshStatus.dividendDecimals,
        },
        { programAddress: inst.dividendTokenProgram as typeof TOKEN_2022_PROGRAM_ADDRESS },
      ),
    ];
    if (freshStatus.landlord) {
      // Coming back: reset the baseline so everything this account holds now stays the landlord's.
      ixs.push(await resyncBaselineIx(inst, signer, freshStatus.dividendAccount));
    } else {
      ixs.push(await registerLandlordIx(inst, signer, freshStatus.dividendAccount, freshStatus.coinAccount));
    }
    // Joining and rejoining both leave collection switched off; this switches it on,
    // with everything the account holds right now set aside as the landlord's.
    ixs.push(await consentIx(inst, signer, "enable_collection"));
    return ixs;
  }));

  const leave = useAction((signal: AbortSignal) => perform(signal, async signer => {
    if (!status) throw new Error("Use the independent recovery controls below while the dashboard is unavailable.");
    const ixs: Instruction[] = [];
    // Recheck the approval instead of relying on the dashboard's older read.
    if (status.delegatedToEndowment || status.delegationTooSmall) {
      ixs.push(await revokeEndowmentApprovalIx(client.rpc, inst, signer));
    }
    if (status.landlord) ixs.push(await deregisterLandlordIx(inst, signer));
    if (!ixs.length) throw new Error("No enrollment or approval to remove. Refresh your wallet.");
    return ixs;
  }));

  const takeBack = useAction((signal: AbortSignal, receipt: Receipt) => perform(signal, async signer => {
    if (receipt.owner !== owner) throw new Error("This contribution belongs to another wallet.");
    return [await settleIx(inst, receipt, signer, false)];
  }));
  // These actions do not depend on a successful dashboard or receipt query.
  const stop = useAction((signal: AbortSignal) => perform(signal, async signer => [await consentIx(inst, signer, "disable_collection")]));
  const revoke = useAction((signal: AbortSignal) => perform(signal, async signer => [await revokeEndowmentApprovalIx(client.rpc, inst, signer)]));
  const busy = optIn.isRunning || leave.isRunning || takeBack.isRunning || stop.isRunning || revoke.isRunning;
  const delegated = Boolean(status?.landlord && status.delegatedToEndowment);
  const isIn = delegated && Boolean(holding?.consent?.enabled);
  const reason = status ? blocker(status, holding) : null;

  let delegation = "Not delegated";
  if (status?.delegatedToEndowment) delegation = "Delegated to the endowment";
  else if (status?.delegationTooSmall) delegation = "Delegated to the endowment, but not in full";
  else if (status?.delegate) delegation = `Delegated to another app (${status.delegate.slice(0, 4)}…${status.delegate.slice(-4)})`;

  return (
    <div className="row-body">
      <PledgeSteps step={isIn ? 4 : optIn.isRunning ? 3 : 2} />
      <div className="onboarding-heading" aria-live="polite">
        <h3 className="onboarding-title">{isIn ? "Your pledge is registered." : optIn.isRunning ? "Review the request in your wallet." : "Review your pledge."}</h3>
        <p className="muted small">{isIn ? "Collection permission is enabled. Collections still depend on eligibility, current checks and running services."
          : "We prepare the approval and enrollment together. You review and confirm one transaction in your wallet."}</p>
      </div>
      {walletIssue && <p role="alert" className="note">{walletIssue}</p>}
      {!canSign && <p role="alert" className="note">This connection can view your wallet but cannot sign the required transaction. Reconnect using a wallet with signing enabled.</p>}
      {expectedOwner && !walletIssue && <p className="small">Connected address matches your Fomo wallet.</p>}
      {status && status.config.params.activateBps === 0 && status.config.params.deactivateBps === 0 && <p className="note">Founders test. The public participation thresholds are not active.</p>}
      <dl className="facts">
        <div className="fact">
          <dt>Wallet</dt>
          <dd>
            <span className="address">{owner}</span>
            <button type="button" className="copy" disabled={busy} onClick={() => disconnect()}>
              Disconnect
            </button>
          </dd>
        </div>
        <div className="fact">
          <dt>$PENIS held</dt>
          <dd>{status ? formatTokens(status.coinBalance) : "…"}</dd>
        </div>
        <div className="fact">
          <dt>PUMP balance</dt>
          <dd>{status ? formatTokens(status.dividendBalance) : "…"}</dd>
        </div>
        <div className="fact">
          <dt>Delegation</dt>
          <dd>{status ? delegation : "…"}</dd>
        </div>
        {status?.landlord && (
          <div className="fact">
            <dt>Collection permission</dt>
            <dd>{holding ? isIn ? "Enabled" : "Disabled for this wallet" : "Not verified"}</dd>
          </div>
        )}
        {status?.landlord && (
          <div className="fact">
            <dt>Contributed</dt>
            <dd>{formatTokens(status.landlord.totalContributed)} PUMP</dd>
          </div>
        )}
      </dl>

      <HeldCollections holding={holding} error={holdingError} busy={busy || !canSign} onRetry={refresh} onReclaim={r => takeBack.dispatch(r)} />

      {status && !isIn && (
        <p className="muted small">
          Eligible $PENIS in this wallet counts toward participation after the required checks. Collection uses a reward allowance and payout checks,
          with your starting PUMP balance protected by the current contract. Want to pledge part of your holdings? Keep the
          rest in another wallet.
        </p>
      )}
      {status && status.delegate && !status.delegatedToEndowment && !status.delegationTooSmall && (
        <p className="muted small">Joining replaces the other app&rsquo;s delegation on your PUMP account.</p>
      )}
      {status?.delegationTooSmall && (
        <p className="muted small">Your approval is smaller than the endowment needs to count you. Rejoin to renew it.</p>
      )}
      {status && !isIn && reason && <p className="small">{reason}</p>}
      {status && !isIn && !reason && !walletIssue && (
        <div className="pledge-review">
          <h4>What you&rsquo;re approving</h4>
          <p className="small">An unlimited PUMP token approval, your enrollment and collection permission in one transaction. Your current PUMP balance becomes the protected starting balance under the current contract. No PUMP or $PENIS is transferred by enrollment.</p>
          <p className="muted small">You pay the network fee and account deposits in SOL. Your wallet shows the transaction before you approve it.</p>
          <label className="consent">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={busy || !canSign} />
            <span>
              {WALLET_CAPTURE_ONLY ? "I want to inspect, without signing, the following proposed permission: unlimited token approval on my PUMP account for collection of $PENIS rewards." : "I authorize unlimited token approval on my PUMP account for collection of $PENIS rewards."} The current
              contract protects my starting balance and limits collection using posted reward totals. Payout checks
              can make mistakes. Each collection waits at least 24 hours; I can reclaim it before release, after which
              this contract cannot refund it. While upgrade authority exists, the code and these protections can
              change. I can stop future collection at any time.
            </span>
          </label>
          <details>
            <summary>What if my wallet shows a warning?</summary>
            <p className="muted small">This requests ongoing access to your PUMP account. A wallet may warn about that permission. If it blocks the request or the details are unexpected, close it and have the transaction reviewed. This page cannot approve or dismiss wallet warnings for you.</p>
          </details>
        </div>
      )}

      <div className="actions">
        {!isIn && (
          <button
            type="button"
            className="button button-primary"
            disabled={busy || !canSign || !status || Boolean(reason) || Boolean(walletIssue) || !agreed}
            onClick={() => optIn.dispatch()}
          >
            {optIn.isRunning
              ? WALLET_CAPTURE_ONLY ? "Preparing unsigned request…" : "Confirm in your wallet…"
              : WALLET_CAPTURE_ONLY ? "Capture unsigned enrollment" : delegated
                ? "Switch collection back on"
                : status?.landlord
                  ? "Rejoin"
                  : "Review in wallet"}
          </button>
        )}
        {isIn && (
          <button type="button" className="button button-primary" disabled>
            You&rsquo;re a landlord
          </button>
        )}
        {status && (status.delegatedToEndowment || status.delegationTooSmall || status.landlord) && (
          <button type="button" className="button" disabled={busy || !canSign} onClick={() => leave.dispatch()}>
            {leave.isRunning ? "Confirm in your wallet…" : "Leave"}
          </button>
        )}
      </div>

      <details open={Boolean(loadError) || !DELEGATION_OPEN}>
        <summary>Independent recovery controls</summary>
        <p className="muted small">
          Stop collection switches your pledge off, and anything being held can then be returned to you. Revoke
          approval removes the endowment&rsquo;s access to your PUMP account; it doesn&rsquo;t touch what&rsquo;s already
          held, which you take back separately. Both work even if the rest of this panel can&rsquo;t load.
        </p>
        <div className="actions">
          <button type="button" className="button" disabled={busy || !canSign} onClick={() => stop.dispatch()}>Stop collection</button>
          <button type="button" className="button" disabled={busy || !canSign} onClick={() => revoke.dispatch()}>Revoke PUMP approval</button>
        </div>
        <p className="muted small">You can also revoke this approval in your wallet&rsquo;s token approval settings.</p>
      </details>
      <button type="button" className="link-button" disabled={busy} onClick={refresh}>Refresh wallet</button>
      {loadError && <p role="alert" className="muted small">{loadError}</p>}
      {actionError && <p role="alert" className="muted small">{actionError}</p>}
      {optIn.isError && <details><summary>Error details</summary><p className="muted small">Enrollment diagnostic: {actionDiagnostic(optIn.error)}</p></details>}
      {lastSignature && (
        <p className="muted small">
          Done. <a href={`https://solscan.io/tx/${lastSignature}`}>View the transaction</a>
        </p>
      )}
    </div>
  );
}

function Chooser({ inst }: { inst: Instance }) {
  const wallets = useWallets(client);
  const connected = useConnectedWallet(client);
  const { dispatchAsync: connect, isRunning } = useConnect(client);
  const [expectedOwner, setExpectedOwner] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const phantom = wallets.find(wallet => wallet.name === "Phantom");
  const connectWallet = async (wallet: (typeof wallets)[number], expected: string | null) => {
    setExpectedOwner(expected);
    setConnectionError(null);
    try {
      await connect(wallet);
    } catch {
      setConnectionError("Connection wasn't completed. Unlock your wallet and try again when you're ready. No pledge was submitted.");
    }
  };

  if (connected) return <Connected key={`${inst.config}:${connected.account.address}`} inst={inst} owner={connected.account.address as Address} expectedOwner={expectedOwner} canSign={Boolean(connected.signer) && connected.supportedTransactionVersions.has(0)} />;
  return (
    <WalletOnboarding phantomAvailable={Boolean(phantom)} connecting={isRunning} connectionError={connectionError}
      onPhantom={expected => { if (phantom) void connectWallet(phantom, expected); }}
      manualWallets={wallets.length ? <div className="actions">
        {wallets.map((wallet) => (
          <button key={wallet.name} type="button" className="button" disabled={isRunning} onClick={() => void connectWallet(wallet, null)}>
            {wallet.name}
          </button>
        ))}
      </div> : <p className="small">No Solana wallet found. Install or unlock a compatible wallet, then reload this page.</p>}
    />
  );
}

export function DelegatePanel() {
  const [inst, setInst] = useState<Instance | null | undefined>(undefined);
  useEffect(() => {
    let current = true;
    flagshipInstance().then(value => { if (current) setInst(value); }).catch(() => { if (current) setInst(null); });
    return () => { current = false; };
  }, []);

  if (inst === null) {
    return (
      <div className="row-body">
        <p>
          {DELEGATION_CLOSED_NOTE} Follow <a href={links.x}>@PenisEndowment</a> for the announcement.
        </p>
      </div>
    );
  }
  if (inst === undefined) return <div className="row-body muted">Loading…</div>;
  return <ConfiguredDelegatePanel inst={inst} />;
}

/** The enrollment switch affects joining only; configured recovery stays usable. */
export function ConfiguredDelegatePanel({ inst }: { inst: Instance }) {
  return (
    <div className="row-body">
      <WalletReadyGate client={client} fallback={<p className="muted">Looking for wallets…</p>}>
        {!DELEGATION_OPEN && <p className="muted small">New pledges and re-enrollment are closed. Existing holders can still stop collection, revoke approval and reclaim pending contributions.</p>}
        <Chooser inst={inst} />
      </WalletReadyGate>
    </div>
  );
}
