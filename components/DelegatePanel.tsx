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
  fetchMaybeMint,
  fetchMaybeToken,
  getApproveCheckedInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  getRevokeInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { useCallback, useEffect, useState } from "react";
import { client } from "@/components/WalletClient";
import {
  ata,
  authorityPda,
  bpsToPercent,
  decodeConfig,
  decodeLandlord,
  decodeRoster,
  deregisterLandlordIx,
  fetchDecoded,
  landlordPda,
  MAX_LANDLORDS,
  registerLandlordIx,
  resyncBaselineIx,
  rosterPda,
  type EndowmentConfig,
  type Instance,
  type LandlordRecord,
  type RosterRecord,
} from "@/lib/endowment";
import { flagshipInstance, formatTokens, TOKEN_DECIMALS } from "@/lib/solana";

/**
 * The delegation is unlimited on purpose. The program counts a landlord, and
 * lets them register, only while at least half of u64::MAX is still approved
 * (`MIN_DELEGATION`), so a bounded approval would silently stop counting once
 * rewards used it up. What limits the endowment is the program, not the amount:
 * it can only move PUMP above the landlord's baseline, into its own vault.
 * We use ApproveChecked so the wallet shows the token and decimals being approved.
 */
const UNLIMITED = BigInt("18446744073709551615");

type Status = {
  inst: Instance;
  config: EndowmentConfig;
  roster: RosterRecord;
  landlord: LandlordRecord | null;
  dividendAccount: Address;
  coinAccount: Address;
  dividendBalance: bigint;
  coinBalance: bigint;
  coinSupply: bigint;
  delegate: Address | null;
  delegatedToEndowment: boolean;
  minStake: bigint;
  now: number;
};

async function loadStatus(inst: Instance, owner: Address): Promise<Status> {
  const dividendAccount = await ata(owner, inst.dividendMint, inst.dividendTokenProgram);
  const coinAccount = await ata(owner, inst.coinMint, inst.coinTokenProgram);
  const [config, roster, landlord, dividend, coin, mint] = await Promise.all([
    fetchDecoded(client.rpc, inst.config, decodeConfig),
    fetchDecoded(client.rpc, await rosterPda(inst.program, inst.config), decodeRoster),
    fetchDecoded(client.rpc, await landlordPda(inst.program, inst.config, owner), decodeLandlord),
    fetchMaybeToken(client.rpc, dividendAccount),
    fetchMaybeToken(client.rpc, coinAccount),
    fetchMaybeMint(client.rpc, inst.coinMint),
  ]);
  if (!config || !roster) throw new Error("The endowment isn't live yet.");
  const authority = await authorityPda(inst.program, inst.config);
  const delegate = dividend.exists && isSome(dividend.data.delegate) ? dividend.data.delegate.value : null;
  const coinSupply = mint.exists ? mint.data.supply : BigInt(0);
  const minStake = (coinSupply * BigInt(config.params.minStakeBps) + BigInt(9_999)) / BigInt(10_000);
  return {
    inst,
    config,
    roster,
    landlord,
    dividendAccount,
    coinAccount,
    dividendBalance: dividend.exists ? dividend.data.amount : BigInt(0),
    coinBalance: coin.exists ? coin.data.amount : BigInt(0),
    coinSupply,
    delegate,
    delegatedToEndowment: delegate === authority,
    minStake,
    now: Math.floor(Date.now() / 1000),
  };
}

/** Why opting in isn't possible right now, in plain words; null if it is. */
function blocker(s: Status): string | null {
  if (s.config.retired) return "The endowment has closed to new landlords.";
  if (s.now < Number(s.config.pausedUntil)) {
    const until = new Date(Number(s.config.pausedUntil) * 1000).toLocaleString();
    return `Joining is paused until ${until}. You can still leave at any time.`;
  }
  if (s.coinBalance < s.minStake) {
    return `Landlords hold at least ${formatTokens(s.minStake)} $PENIS (${bpsToPercent(s.config.params.minStakeBps)}% of supply). This wallet holds ${formatTokens(s.coinBalance)}.`;
  }
  if (!s.landlord && s.roster.entries.length >= MAX_LANDLORDS && !evictionTarget(s)) {
    return `All ${MAX_LANDLORDS} landlord places are taken by wallets holding more $PENIS than this one.`;
  }
  return null;
}

/** When the roster is full, the smallest recorded stake gives way to a larger newcomer. */
function evictionTarget(s: Status): RosterRecord["entries"][number] | null {
  if (s.roster.entries.length < MAX_LANDLORDS) return null;
  const smallest = s.roster.entries.reduce((a, b) => (b.snapshot < a.snapshot ? b : a));
  return s.coinBalance > smallest.snapshot ? smallest : null;
}

function Connected({ inst }: { inst: Instance }) {
  const connected = useConnectedWallet(client);
  const { dispatch: disconnect } = useDisconnect(client);
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const owner = connected?.account.address as Address | undefined;

  const refresh = useCallback(async () => {
    if (!owner) return;
    setLoadError(null);
    try {
      setStatus(await loadStatus(inst, owner));
    } catch (e) {
      setLoadError(e instanceof Error && e.message.includes("live") ? e.message : "Couldn't read your wallet from the network. Try again in a moment.");
    }
  }, [inst, owner]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const optIn = useAction(async (signal: AbortSignal) => {
    if (!status) throw new Error("No status");
    const signer = client.identity;
    const authority = await authorityPda(inst.program, inst.config);
    const ixs: Instruction[] = [
      getCreateAssociatedTokenIdempotentInstruction({
        payer: signer,
        owner: signer.address,
        mint: inst.dividendMint,
        ata: status.dividendAccount,
        tokenProgram: inst.dividendTokenProgram,
      }),
      getApproveCheckedInstruction(
        {
          source: status.dividendAccount,
          mint: inst.dividendMint,
          delegate: authority,
          owner: signer,
          amount: UNLIMITED,
          decimals: TOKEN_DECIMALS,
        },
        { programAddress: inst.dividendTokenProgram as typeof TOKEN_2022_PROGRAM_ADDRESS },
      ),
    ];
    if (status.landlord) {
      // Coming back: reset the baseline so everything this account holds now stays the landlord's.
      ixs.push(await resyncBaselineIx(inst, signer, status.dividendAccount));
    } else {
      const target = evictionTarget(status);
      const evict = target
        ? { landlord: await landlordPda(inst.program, inst.config, target.owner), owner: target.owner }
        : null;
      ixs.push(await registerLandlordIx(inst, signer, status.dividendAccount, status.coinAccount, evict));
    }
    const result = await client.sendTransaction(ixs, { abortSignal: signal });
    await refresh();
    return result.context.signature;
  });

  const leave = useAction(async (signal: AbortSignal) => {
    if (!status) throw new Error("No status");
    const signer = client.identity;
    const ixs: Instruction[] = [];
    if (status.delegate) {
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
  const busy = optIn.isRunning || leave.isRunning;
  const lastSignature = optIn.data ?? leave.data;
  const error = optIn.error ?? leave.error;
  const isIn = Boolean(status?.landlord && status.delegatedToEndowment);
  const reason = status ? blocker(status) : null;

  let delegation = "Not delegated";
  if (status?.delegatedToEndowment) delegation = "Delegated to the endowment";
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

      {status && !isIn && (
        <p className="muted small">
          Once you join, all new PUMP that arrives in this wallet&rsquo;s PUMP account goes to the endowment, whatever
          its source. The PUMP it holds today stays yours. Many landlords use a wallet that holds only $PENIS.
        </p>
      )}
      {status && status.delegate && !status.delegatedToEndowment && (
        <p className="muted small">Joining replaces the other app&rsquo;s delegation on your PUMP account.</p>
      )}
      {status && !isIn && reason && <p className="small">{reason}</p>}

      <div className="actions">
        {!isIn && (
          <button
            type="button"
            className="button button-primary"
            disabled={busy || !status || Boolean(reason)}
            onClick={() => optIn.dispatch()}
          >
            {optIn.isRunning ? "Confirm in your wallet…" : status?.landlord ? "Rejoin" : "Delegate my PUMP rewards"}
          </button>
        )}
        {isIn && (
          <button type="button" className="button button-primary" disabled>
            You&rsquo;re a landlord
          </button>
        )}
        {status && (status.delegate || status.landlord) && (
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
      <p>Connect the wallet that holds your $PENIS.</p>
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
        <p>Delegation opens at launch. Follow @PenisEndowment for the announcement.</p>
      </div>
    );
  }
  return (
    <WalletReadyGate client={client} fallback={<div className="row-body muted">Looking for wallets…</div>}>
      <Chooser inst={inst} />
    </WalletReadyGate>
  );
}
