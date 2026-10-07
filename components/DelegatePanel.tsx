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
import { client } from "@/components/WalletClient";
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

function Connected({ inst, owner }: { inst: Instance; owner: Address }) {
  const { dispatch: disconnect } = useDisconnect(client);
  const [status, setStatus] = useState<DelegationStatus | null>(null);
  const [holding, setHolding] = useState<Holding | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [holdingError, setHoldingError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [reload, setReload] = useState(0);
  const [lastSignature, setLastSignature] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const refresh = () => {
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
    let submitted = false;
    try {
      const signer = client.identity;
      if (signer.address !== owner) throw new Error("Your connected wallet changed. Reconnect and try again.");
      const instructions = await build(signer);
      if (client.identity.address !== owner) throw new Error("Your connected wallet changed. Reconnect and try again.");
      submitted = true;
      const result = await client.sendTransaction(instructions, { abortSignal: signal });
      setLastSignature(result.context.signature);
      setAgreed(false);
      refresh();
      return result.context.signature;
    } catch (e) {
      setActionError(submitted ? "Couldn't confirm the action. Check your wallet activity and refresh before retrying."
        : e instanceof Error ? e.message : "Couldn't prepare the action. Please try again.");
      throw e;
    }
  };

  const optIn = useAction((signal: AbortSignal) => perform(signal, async signer => {
    if (!status || !holding || !agreed || blocker(status, holding)) throw new Error("Joining is unavailable. Refresh and review the pledge before signing.");
    const authority = await authorityPda(inst.program, inst.config);
    const ixs: Instruction[] = [
      getCreateAssociatedTokenIdempotentInstruction({
        payer: signer,
        owner: signer.address,
        mint: inst.dividendMint,
        ata: status.dividendAccount,
        tokenProgram: inst.dividendTokenProgram,
      }),
      // Registering needs the coin account to exist, even while it's empty (audit L-12).
      getCreateAssociatedTokenIdempotentInstruction({
        payer: signer,
        owner: signer.address,
        mint: inst.coinMint,
        ata: status.coinAccount,
        tokenProgram: inst.coinTokenProgram,
      }),
      getApproveCheckedInstruction(
        {
          source: status.dividendAccount,
          mint: inst.dividendMint,
          delegate: authority,
          owner: signer,
          amount: UNLIMITED,
          decimals: status.dividendDecimals,
        },
        { programAddress: inst.dividendTokenProgram as typeof TOKEN_2022_PROGRAM_ADDRESS },
      ),
    ];
    if (status.landlord) {
      // Coming back: reset the baseline so everything this account holds now stays the landlord's.
      ixs.push(await resyncBaselineIx(inst, signer, status.dividendAccount));
    } else {
      ixs.push(await registerLandlordIx(inst, signer, status.dividendAccount, status.coinAccount));
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
      <dl className="facts">
        <div className="fact">
          <dt>Wallet</dt>
          <dd>
            <span className="address">{owner}</span>
            <button type="button" className="copy" onClick={() => disconnect()}>
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

      <HeldCollections holding={holding} error={holdingError} busy={busy} onRetry={refresh} onReclaim={r => takeBack.dispatch(r)} />

      {status && !isIn && (
        <p className="muted small">
          The $PENIS in this wallet counts toward the 30%. Collection uses a reward allowance and payout checks,
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
      {status && !isIn && !reason && (
        <label className="consent">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={busy} />
          <span>
            I authorize unlimited token approval on my PUMP account for collection of $PENIS rewards. The current
            contract protects my starting balance and limits collection using posted reward totals. Payout checks
            can make mistakes. Each collection waits at least 24 hours; I can reclaim it before release, after which
            this contract cannot refund it. While upgrade authority exists, the code and these protections can
            change. I can stop future collection at any time.
          </span>
        </label>
      )}

      <div className="actions">
        {!isIn && (
          <button
            type="button"
            className="button button-primary"
            disabled={busy || !status || Boolean(reason) || !agreed}
            onClick={() => optIn.dispatch()}
          >
            {optIn.isRunning
              ? "Confirm in your wallet…"
              : delegated
                ? "Switch collection back on"
                : status?.landlord
                  ? "Rejoin"
                  : "Delegate my PUMP rewards"}
          </button>
        )}
        {isIn && (
          <button type="button" className="button button-primary" disabled>
            You&rsquo;re a landlord
          </button>
        )}
        {status && (status.delegatedToEndowment || status.delegationTooSmall || status.landlord) && (
          <button type="button" className="button" disabled={busy} onClick={() => leave.dispatch()}>
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
          <button type="button" className="button" disabled={busy} onClick={() => stop.dispatch()}>Stop collection</button>
          <button type="button" className="button" disabled={busy} onClick={() => revoke.dispatch()}>Revoke PUMP approval</button>
        </div>
        <p className="muted small">You can also revoke this approval in your wallet&rsquo;s token approval settings.</p>
      </details>
      <button type="button" className="link-button" disabled={busy} onClick={refresh}>Refresh wallet</button>
      {loadError && <p role="alert" className="muted small">{loadError}</p>}
      {actionError && <p role="alert" className="muted small">{actionError}</p>}
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
  const { dispatch: connect, isRunning } = useConnect(client);

  if (connected) return <Connected key={`${inst.config}:${connected.account.address}`} inst={inst} owner={connected.account.address as Address} />;
  if (wallets.length === 0) {
    return (
      <div className="row-body">
        <p>No Solana wallet found in this browser. Install Phantom, Solflare or Backpack, then reload.</p>
      </div>
    );
  }
  return (
    <div className="row-body">
      <p>Connect your wallet to manage a pledge or reclaim pending contributions.</p>
      <div className="actions">
        {wallets.map((wallet) => (
          <button key={wallet.name} type="button" className="button" disabled={isRunning} onClick={() => connect(wallet)}>
            {wallet.name}
          </button>
        ))}
      </div>
    </div>
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
    <WalletReadyGate client={client} fallback={<div className="row-body muted">Looking for wallets…</div>}>
      {!DELEGATION_OPEN && <p className="muted small">New pledges and re-enrollment are closed. Existing holders can still stop collection, revoke approval and reclaim pending contributions.</p>}
      <Chooser inst={inst} />
    </WalletReadyGate>
  );
}
