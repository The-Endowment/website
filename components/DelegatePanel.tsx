"use client";

import { isSome, type Address } from "@solana/kit";
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
  findAssociatedTokenPda,
  getApproveInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  getRevokeInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { useCallback, useEffect, useState } from "react";
import { client } from "@/components/WalletClient";
import {
  authorityPda,
  formatTokens,
  landlordPda,
  PENIS,
  PROGRAM_ID,
  PUMP_MINT,
  registerLandlordInstruction,
  U64_MAX,
} from "@/lib/solana";

type Status = {
  pumpAccount: Address;
  penisAccount: Address;
  pumpBalance: bigint;
  penisBalance: bigint;
  delegate: Address | null;
  delegatedToEndowment: boolean;
  registered: boolean;
};

async function ata(owner: Address, mint: Address) {
  const [account] = await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS });
  return account;
}

async function loadStatus(owner: Address): Promise<Status> {
  const pumpAccount = await ata(owner, PUMP_MINT);
  const penisAccount = await ata(owner, PENIS);
  const [pump, penis] = await Promise.all([
    fetchMaybeToken(client.rpc, pumpAccount),
    fetchMaybeToken(client.rpc, penisAccount),
  ]);
  const delegate = pump.exists && isSome(pump.data.delegate) ? pump.data.delegate.value : null;
  let delegatedToEndowment = false;
  let registered = false;
  if (PROGRAM_ID) {
    const authority = await authorityPda(PROGRAM_ID);
    delegatedToEndowment = delegate === authority;
    const landlord = await client.rpc.getAccountInfo(await landlordPda(PROGRAM_ID, owner), { encoding: "base64" }).send();
    registered = landlord.value !== null;
  }
  return {
    pumpAccount,
    penisAccount,
    pumpBalance: pump.exists ? pump.data.amount : BigInt(0),
    penisBalance: penis.exists ? penis.data.amount : BigInt(0),
    delegate,
    delegatedToEndowment,
    registered,
  };
}

function short(a: string) {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

function Connected() {
  const connected = useConnectedWallet(client);
  const { dispatch: disconnect } = useDisconnect(client);
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const owner = connected?.account.address as Address | undefined;

  const refresh = useCallback(async () => {
    if (!owner) return;
    setLoadError(null);
    try {
      setStatus(await loadStatus(owner));
    } catch {
      setLoadError("Couldn't read your wallet from the network. Try again in a moment.");
    }
  }, [owner]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const optIn = useAction(async (signal: AbortSignal) => {
    if (!PROGRAM_ID || !status) throw new Error("Not open yet");
    const signer = client.identity;
    const ixs = [
      getCreateAssociatedTokenIdempotentInstruction({
        payer: signer,
        owner: signer.address,
        mint: PUMP_MINT,
        ata: status.pumpAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      }),
      getApproveInstruction({
        source: status.pumpAccount,
        delegate: await authorityPda(PROGRAM_ID),
        owner: signer,
        amount: U64_MAX,
      }),
      ...(status.registered
        ? []
        : [await registerLandlordInstruction(PROGRAM_ID, signer, status.pumpAccount, status.penisAccount)]),
    ];
    const result = await client.sendTransaction(ixs, { abortSignal: signal });
    await refresh();
    return result.context.signature;
  });

  const revoke = useAction(async (signal: AbortSignal) => {
    if (!status) throw new Error("No status");
    const ix = getRevokeInstruction({ source: status.pumpAccount, owner: client.identity });
    const result = await client.sendTransaction([ix], { abortSignal: signal });
    await refresh();
    return result.context.signature;
  });

  if (!connected || !owner) return null;
  const busy = optIn.isRunning || revoke.isRunning;
  const lastSignature = optIn.data ?? revoke.data;
  const error = optIn.error ?? revoke.error;

  let delegation = "Not delegated";
  if (status?.delegatedToEndowment) delegation = "Delegated to the endowment";
  else if (status?.delegate) delegation = `Delegated to another app (${short(status.delegate)})`;

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
          <dd>{status ? formatTokens(status.penisBalance) : "…"}</dd>
        </div>
        <div className="fact">
          <dt>PUMP balance</dt>
          <dd>{status ? formatTokens(status.pumpBalance) : "…"}</dd>
        </div>
        <div className="fact">
          <dt>Delegation</dt>
          <dd>{status ? delegation : "…"}</dd>
        </div>
        {PROGRAM_ID && (
          <div className="fact">
            <dt>Landlord</dt>
            <dd>{status ? (status.registered ? "Registered" : "Not registered") : "…"}</dd>
          </div>
        )}
      </dl>

      {status && status.delegate && !status.delegatedToEndowment && (
        <p className="muted small">
          Another app holds the delegation on your PUMP account. Opting in replaces it with the endowment.
        </p>
      )}

      <div className="actions">
        {PROGRAM_ID ? (
          <button
            type="button"
            className="button button-primary"
            disabled={busy || !status || (status.delegatedToEndowment && status.registered)}
            onClick={() => optIn.dispatch()}
          >
            {status?.delegatedToEndowment && status.registered
              ? "You're in"
              : optIn.isRunning
                ? "Confirm in your wallet…"
                : "Delegate my PUMP rewards"}
          </button>
        ) : (
          <button type="button" className="button button-primary" disabled>
            Opens at launch
          </button>
        )}
        {status?.delegate && (
          <button type="button" className="button" disabled={busy} onClick={() => revoke.dispatch()}>
            {revoke.isRunning ? "Confirm in your wallet…" : "Revoke delegation"}
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

function Chooser() {
  const wallets = useWallets(client);
  const connected = useConnectedWallet(client);
  const { dispatch: connect, isRunning } = useConnect(client);

  if (connected) return <Connected />;
  if (wallets.length === 0) {
    return (
      <div className="row-body">
        <p>No Solana wallet found in this browser. Install Phantom, Solflare or Backpack, then reload.</p>
      </div>
    );
  }
  return (
    <div className="row-body">
      <p>Connect the wallet that holds your $PENIS.</p>
      <div className="actions">
        {wallets.map((wallet) => (
          <button
            key={wallet.name}
            type="button"
            className="button"
            disabled={isRunning}
            onClick={() => connect(wallet)}
          >
            {wallet.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DelegatePanel() {
  return (
    <WalletReadyGate client={client} fallback={<div className="row-body muted">Looking for wallets…</div>}>
      <Chooser />
    </WalletReadyGate>
  );
}
