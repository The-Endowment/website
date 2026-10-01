"use client";

import { isSome, type Address, type Instruction } from "@solana/kit";
import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useWallets,
  WalletReadyGate,
} from "@solana/kit-plugin-wallet/react";
import { useAction } from "@solana/react";
import {
  fetchMaybeToken,
  getRevokeInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { useCallback, useEffect, useState } from "react";
import { client } from "@/components/WalletClient";
import {
  ata,
  authorityPda,
  decodeConfig,
  decodeLandlord,
  deregisterLandlordIx,
  fetchDecoded,
  isFlagshipConfig,
  landlordPda,
  MIN_DELEGATION,
  type Instance,
  type LandlordRecord,
} from "@/lib/endowment";
import type { EndowmentSummary } from "@/app/api/endowments/route";
import { flagshipInstance, formatTokens } from "@/lib/solana";
import { COLLECTION_PENDING_NOTICE } from "@/lib/collection-policy";

type Status = {
  inst: Instance;
  landlord: LandlordRecord | null;
  dividendAccount: Address;
  dividendBalance: bigint;
  coinBalance: bigint;
  delegate: Address | null;
  /** Delegated to this endowment, in full (the program needs at least MIN_DELEGATION). */
  delegatedToEndowment: boolean;
  /** Delegated to this endowment, but for less than the legacy count requires. */
  delegationTooSmall: boolean;
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

async function loadStatus(inst: Instance, owner: Address): Promise<Status> {
  const dividendAccount = await ata(owner, inst.dividendMint, inst.dividendTokenProgram);
  const coinAccount = await ata(owner, inst.coinMint, inst.coinTokenProgram);
  const [config, landlord, dividend, coin] = await Promise.all([
    fetchDecoded(client.rpc, inst.config, decodeConfig),
    fetchDecoded(client.rpc, await landlordPda(inst.program, inst.config, owner), decodeLandlord),
    fetchMaybeToken(client.rpc, dividendAccount),
    fetchMaybeToken(client.rpc, coinAccount),
  ]);
  // Only manage legacy enrollment for the verified flagship.
  if (!config || !isFlagshipConfig(config)) throw new Error("The endowment isn't live yet.");
  const authority = await authorityPda(inst.program, inst.config);
  const delegate = dividend.exists && isSome(dividend.data.delegate) ? dividend.data.delegate.value : null;
  const delegatedAmount = dividend.exists ? dividend.data.delegatedAmount : BigInt(0);
  const ours = delegate === authority;
  return {
    inst,
    landlord,
    dividendAccount,
    dividendBalance: dividend.exists ? dividend.data.amount : BigInt(0),
    coinBalance: coin.exists ? coin.data.amount : BigInt(0),
    delegate,
    delegatedToEndowment: ours && delegatedAmount >= MIN_DELEGATION,
    delegationTooSmall: ours && delegatedAmount < MIN_DELEGATION,
    otherEndowment: delegate && !ours ? await endowmentNamed(inst.program, delegate) : null,
  };
}

function Connected({ inst }: { inst: Instance }) {
  const connected = useConnectedWallet(client);
  const { dispatch: disconnect } = useDisconnect(client);
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const owner = connected?.account.address as Address | undefined;

  const refresh = useCallback(async () => {
    if (!owner) return;
    await loadStatus(inst, owner).then(
      (next) => {
        setStatus(next);
        setLoadError(null);
      },
      (e: unknown) => {
        setLoadError(e instanceof Error && e.message.includes("live") ? e.message : "Couldn't read your wallet from the network. Try again in a moment.");
      },
    );
  }, [inst, owner]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const leave = useAction(async (signal: AbortSignal) => {
    if (!status) throw new Error("No status");
    const signer = client.identity;
    const ixs: Instruction[] = [];
    // Only this endowment's delegation: another app's or endowment's is left alone (audit KW-10).
    if (status.delegatedToEndowment || status.delegationTooSmall) {
      ixs.push(
        getRevokeInstruction(
          { source: status.dividendAccount, owner: signer },
          { programAddress: inst.dividendTokenProgram as typeof TOKEN_2022_PROGRAM_ADDRESS },
        ),
      );
    }
    if (status.landlord) ixs.push(await deregisterLandlordIx(inst, signer));
    const result = await client.sendTransaction(ixs, { abortSignal: signal });
    await refresh();
    return result.context.signature;
  });

  if (!connected || !owner) return null;
  const busy = leave.isRunning;
  const lastSignature = leave.data;
  const error = leave.error;
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
            <dt>Contributed</dt>
            <dd>{formatTokens(status.landlord.totalContributed)} PUMP</dd>
          </div>
        )}
      </dl>

      <p className="small">{COLLECTION_PENDING_NOTICE}</p>
      {status && (status.delegatedToEndowment || status.delegationTooSmall) && (
        <p className="muted small">
          Your existing PUMP approval remains on-chain. The old contract can collect PUMP above its baseline,
          including purchases. Use Leave to revoke this endowment&rsquo;s approval and remove your enrollment.
        </p>
      )}

      <div className="actions">
        {!isIn && <button type="button" className="button button-primary" disabled>Enrollment closed</button>}
        {isIn && (
          <button type="button" className="button button-primary" disabled>
            Existing enrollment
          </button>
        )}
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

  if (connected) return <Connected inst={inst} />;
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
