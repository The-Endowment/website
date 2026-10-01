"use client";

import { type Address, type Instruction } from "@solana/kit";
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
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "@/components/WalletClient";
import {
  authorityPda,
  isFlagshipConfig,
  type Instance,
} from "@/lib/endowment";
import type { EndowmentSummary } from "@/app/api/endowments/route";
import { flagshipInstance, formatTokens } from "@/lib/solana";
import { COLLECTION_RELEASED, COLLECTION_PENDING_NOTICE } from "@/lib/collection-policy";

import { enrollRewardsIx, renewRewardConsentIx } from "@/lib/reward-client";
import { loadExitStatus, loadEnrollmentDetails, ownerExitInstructions, type ExitStatus, type EnrollmentDetails } from "@/lib/enrollment-status";

type Status = ExitStatus & {
  enrollment: EnrollmentDetails | null;
  /** When the delegate is another endowment on the contract, its coin's symbol. */
  otherEndowment: string | null;
};

/** The coin symbol of the endowment whose authority is `delegate`, if it's one on this contract. */
async function endowmentNamed(program: Address, delegate: Address): Promise<string | null> {
  try {
    const { endowments } = (await (await fetch("/api/endowments")).json()) as { endowments: EndowmentSummary[] };
    for (const e of endowments) {
      if ((await authorityPda(program, e.config as Address)) === delegate) {
        return e.symbol ? `$${e.symbol}` : `${e.coinMint.slice(0, 4)}…${e.coinMint.slice(-4)}`;
      }
    }
  } catch {
    // Unnamed: shown as an address.
  }
  return null;
}

function joinBlocker(status: Status): string | null {
  if (!COLLECTION_RELEASED) return COLLECTION_PENDING_NOTICE;
  const details = status.enrollment;
  if (!details || status.readErrors.length) return "Enrollment information could not be verified. You can still remove a verified approval or enrollment.";
  if (!isFlagshipConfig(details.config)) return "The endowment isn't live yet.";
  if (details.config.version !== 4 || (status.landlord && status.landlord.version !== 4)) return "Leave the legacy enrollment before joining the replacement.";
  if (!details.policy || details.policy.disabled) return "The reward reporting service is unavailable.";
  if (details.config.milestoneReached || (details.directBalance !== null && details.directBalance >= details.config.contributionCap)) return "Funding is complete. Holder contributions have ended.";
  if (details.directBalance === null) return "The endowment balance could not be verified.";
  if (details.config.retired) return "The endowment has closed enrollment.";
  if (BigInt(Math.floor(Date.now() / 1000)) < details.config.pausedUntil) return "Enrollment is paused. You can still leave.";
  if (details.coinBalance < details.minStake) return `Enrollment requires at least ${formatTokens(details.minStake)} PENIS in this wallet.`;
  if (status.delegate && !status.delegatedToEndowment && !status.delegationTooSmall) return "Revoke the other app's PUMP delegation before joining.";
  return null;
}

function Connected({ inst }: { inst: Instance }) {
  const connected = useConnectedWallet(client);
  const { dispatch: disconnect } = useDisconnect(client);
  const [accepted, setAccepted] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const refreshId = useRef(0);
  const owner = connected?.account.address as Address | undefined;

  const refresh = useCallback(async () => {
    if (!owner) return;
    const request = ++refreshId.current;
    await loadExitStatus(client.rpc, inst, owner).then((exit) => {
      if (request !== refreshId.current) return;
      const next: Status = { ...exit, enrollment: null, otherEndowment: null };
      // Show Leave immediately, even if an enrollment-only dependency stalls or rejects.
      setStatus(next);
      setLoadError(exit.readErrors.length ? `${exit.readErrors.join(" ")} Leave can only remove verified permissions.` : null);
      void loadEnrollmentDetails(client.rpc, inst, owner).then(
        (enrollment) => { if (request === refreshId.current) setStatus((current) => current ? { ...current, enrollment } : current); },
        () => { if (request === refreshId.current) setLoadError("Enrollment information is unavailable. You can still remove a verified approval or enrollment."); },
      );
      if (exit.delegate && !exit.delegatedToEndowment && !exit.delegationTooSmall) {
        void endowmentNamed(inst.program, exit.delegate).then((otherEndowment) =>
          { if (request === refreshId.current) setStatus((current) => current ? { ...current, otherEndowment } : current); });
      }
    }, () => {
      if (request !== refreshId.current) return;
      setStatus(null);
      setLoadError("Couldn't verify your PUMP delegation or enrollment. Try again in a moment.");
    });
  }, [inst, owner]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const optIn = useAction(async (signal: AbortSignal) => {
    if (!owner || !status || !accepted) throw new Error("Consent is required");
    const [exit, enrollment] = await Promise.all([loadExitStatus(client.rpc, inst, owner), loadEnrollmentDetails(client.rpc, inst, owner)]);
    const fresh: Status = { ...exit, enrollment, otherEndowment: null };
    const reason = joinBlocker(fresh);
    if (reason) throw new Error(reason);
    if (enrollment.policy?.reporter !== status.enrollment?.policy?.reporter) {
      setAccepted(false); setStatus(fresh);
      throw new Error("The reporter changed. Review the current policy before consenting.");
    }
    const signer = client.identity;
    if (signer.address !== owner) throw new Error("The connected wallet changed. Refresh before continuing.");
    const authority = await authorityPda(inst.program, inst.config);
    const ixs: Instruction[] = [
      getCreateAssociatedTokenIdempotentInstruction({ payer: signer, owner: signer.address, mint: inst.dividendMint, ata: fresh.dividendAccount, tokenProgram: inst.dividendTokenProgram }),
      getCreateAssociatedTokenIdempotentInstruction({ payer: signer, owner: signer.address, mint: inst.coinMint, ata: enrollment.coinAccount, tokenProgram: inst.coinTokenProgram }),
      getApproveCheckedInstruction({ source: fresh.dividendAccount, mint: inst.dividendMint, delegate: authority, owner: signer, amount: (1n << 64n) - 1n, decimals: 6 },
        { programAddress: inst.dividendTokenProgram as typeof TOKEN_2022_PROGRAM_ADDRESS }),
      fresh.landlord ? await renewRewardConsentIx(inst, signer) : await enrollRewardsIx(inst, signer),
    ];
    if (client.identity.address !== owner) throw new Error("The connected wallet changed. Refresh before continuing.");
    const result = await client.sendTransaction(ixs, { abortSignal: signal });
    setAccepted(false); await refresh();
    return result.context.signature;
  });

  const leave = useAction(async (signal: AbortSignal) => {
    if (!owner) throw new Error("No connected wallet");
    const signer = client.identity;
    if (signer.address !== owner) throw new Error("The connected wallet changed. Refresh before continuing.");
    const ixs = await ownerExitInstructions(client.rpc, inst, signer);
    if (client.identity.address !== owner) throw new Error("The connected wallet changed. Refresh before continuing.");
    const result = await client.sendTransaction(ixs, { abortSignal: signal });
    await refresh();
    return result.context.signature;
  });

  if (!connected || !owner) return null;
  const busy = leave.isRunning || optIn.isRunning;
  const lastSignature = leave.data ?? optIn.data;
  const error = leave.error ?? optIn.error;
  const reason = status ? joinBlocker(status) : "Loading wallet state…";
  const isIn = Boolean(status?.landlord && status.delegatedToEndowment);

  let delegation = "Not delegated";
  if (status?.delegatedToEndowment) delegation = "Delegated to the endowment";
  else if (status?.delegationTooSmall) delegation = "Delegated to the endowment, but not in full";
  else if (status?.otherEndowment) delegation = `Delegated to the ${status.otherEndowment} endowment`;
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
          <dd>{status?.enrollment ? formatTokens(status.enrollment.coinBalance) : "…"}</dd>
        </div>
        <div className="fact">
          <dt>PUMP balance</dt>
          <dd>{status?.dividendBalance != null ? formatTokens(status.dividendBalance) : "…"}</dd>
        </div>
        <div className="fact">
          <dt>Delegation</dt>
          <dd>{status?.delegate !== undefined ? delegation : "…"}</dd>
        </div>
        {status?.landlord && (
          <div className="fact">
            <dt>Contributed</dt>
            <dd>{formatTokens(status.landlord.totalContributed)} PUMP</dd>
          </div>
        )}
      </dl>

      <p className="small">{COLLECTION_PENDING_NOTICE}</p>
      {status?.enrollment && !status.enrollment.config.holding && status.enrollment.config.version !== 4 && (status.delegatedToEndowment || status.delegationTooSmall) && (
        <p className="muted small">
          Your existing PUMP approval remains on-chain. The old contract can collect PUMP above its baseline,
          including purchases. Use Leave to revoke this endowment&rsquo;s approval and remove your enrollment.
        </p>
      )}

      <p className="small">
        This page manages earlier approvals. The current refundable-collection proposal covers verified PENIS rewards paid in PUMP; review it on the Contributions page.
        Existing PUMP, purchases, ordinary transfers, and inactive-period rewards are excluded by that service&rsquo;s policy.
        The contract trusts the reporter: a mistake or compromised key can collect other PUMP. Collection limits do not prove the origin of PUMP.
        Your wallet grants a broad, revocable PUMP allowance; PENIS is not delegated. Retained program upgrade authority can change these protections.
      </p>
      {status?.enrollment?.policy && <p className="muted small">Reporter: <span className="address">{status.enrollment.policy.reporter}</span></p>}
      <label className="small">
        <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} disabled={busy || Boolean(reason)} />{" "}
        I understand the trusted reporter and broad PUMP allowance, with no daily wallet cap, and pledge eligible rewards while funding is active.
      </label>
      {reason && <p className="muted small">{reason}</p>}
      <div className="actions">
        <button type="button" className="button button-primary" disabled={busy || !accepted || Boolean(reason)} onClick={() => optIn.dispatch()}>
          {optIn.isRunning ? "Confirm in your wallet…" : !COLLECTION_RELEASED ? "Enrollment closed for review" : isIn ? "Renew reward consent" : "Pledge reward PUMP"}
        </button>
        {status && (status.delegatedToEndowment || status.delegationTooSmall || status.landlord) && (
          <button type="button" className="button" disabled={busy} onClick={() => leave.dispatch()}>
            {leave.isRunning ? "Confirm in your wallet…" : "Leave"}
          </button>
        )}
      </div>

      {loadError && <p className="muted small">{loadError}</p>}
      {error != null && <p className="muted small">The transaction didn&rsquo;t go through. Nothing changed.</p>}
      {lastSignature && (
        <p className="muted small">
          Transaction confirmed. <a href={`https://solscan.io/tx/${lastSignature}`}>View the transaction</a>
        </p>
      )}
    </div>
  );
}

function Chooser({ inst }: { inst: Instance }) {
  const wallets = useWallets(client);
  const connected = useConnectedWallet(client);
  const { dispatch: connect, isRunning } = useConnect(client);

  if (connected) return <Connected key={connected.account.address} inst={inst} />;
  if (wallets.length === 0) {
    return (
      <div className="row-body">
        <p>No Solana wallet found in this browser. Install Phantom, Solflare or Backpack, then reload.</p>
      </div>
    );
  }
  return (
    <div className="row-body">
      <p>Connect your wallet to review an existing enrollment or leave.</p>
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
    flagshipInstance().then(setInst);
  }, []);

  if (inst === undefined) return <div className="row-body muted">Loading…</div>;
  if (inst === null) {
    return (
      <div className="row-body">
        <p>{COLLECTION_PENDING_NOTICE}</p>
      </div>
    );
  }
  return (
    <WalletReadyGate client={client} fallback={<div className="row-body muted">Looking for wallets…</div>}>
      <Chooser inst={inst} />
    </WalletReadyGate>
  );
}
