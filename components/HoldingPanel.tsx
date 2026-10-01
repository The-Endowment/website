"use client";
import { useCallback, useEffect, useState } from "react";
import { type Address, type Instruction } from "@solana/kit";
import {
  getApproveCheckedInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useWallets,
  WalletReadyGate,
} from "@solana/kit-plugin-wallet/react";
import { HoldingReceipts } from "./HoldingReceipts";
import { client } from "@/components/WalletClient";
import { type Instance } from "@/lib/endowment";
import { flagshipInstance, RPC_URL } from "@/lib/solana";
import { common, consentIx, settleIx } from "@/lib/holding/client";
import {
  holdSnapshot,
  pendingReceipts,
  type HoldSnapshot,
} from "@/lib/holding/snapshot";
import { stopCollection } from "@/lib/holding/exit";
import { HOLD_COLLECTION_RELEASED } from "@/lib/holding/release";
import { jsonRpc } from "@/lib/reporter/rpc";
import type { Receipt } from "@/lib/holding/types";
const rpc = jsonRpc(RPC_URL);
function Connected({ inst }: { inst: Instance }) {
  const connected = useConnectedWallet(client);
  const { dispatch: disconnect } = useDisconnect(client);
  const owner = connected!.account.address as Address;
  const [rows, setRows] = useState<{ address: Address; receipt: Receipt }[]>(
    [],
  );
  const [snapshot, setSnapshot] = useState<HoldSnapshot | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(
    () =>
      Promise.allSettled([
        pendingReceipts(rpc, inst, owner),
        holdSnapshot(rpc, inst, owner),
      ]),
    [inst, owner],
  );
  const apply = useCallback((results: Awaited<ReturnType<typeof load>>) => {
    // Reclaim remains available even if enrollment/market reads fail.
    if (results[0].status === "fulfilled") setRows(results[0].value);
    else {
      setRows([]);
      setMessage(
        "Pending contributions could not be loaded. Refresh before acting.",
      );
    }
    if (results[1].status === "fulfilled") setSnapshot(results[1].value);
    else setSnapshot(null);
  }, []);
  const refresh = useCallback(async () => apply(await load()), [apply, load]);
  useEffect(() => {
    let cancelled = false;
    void load().then((results) => {
      if (!cancelled) apply(results);
    });
    return () => {
      cancelled = true;
    };
  }, [apply, load]);
  const act = async (
    action: "reclaim" | "stop" | "join",
    selected?: Address,
  ) => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const signer = client.identity;
      if (signer.address !== owner)
        throw new Error(
          "The connected wallet changed. Refresh before continuing.",
        );
      let ixs: Instruction[];
      if (action === "reclaim") {
        const latest = (await pendingReceipts(rpc, inst, owner)).find(
          (row) => row.address === selected,
        );
        if (!latest)
          throw new Error(
            "This contribution has already been settled. Refresh its status.",
          );
        ixs = [await settleIx(inst, latest.receipt, signer, false)];
      } else if (action === "stop") {
        ixs = await stopCollection(client.rpc, rpc, inst, signer);
      } else {
        if (!HOLD_COLLECTION_RELEASED || !accepted)
          throw new Error("Enrollment is closed pending review.");
        const fresh = await holdSnapshot(rpc, inst, owner);
        if (
          !snapshot ||
          fresh.policy.collector !== snapshot.policy.collector ||
          fresh.policy.reviewer !== snapshot.policy.reviewer
        ) {
          setAccepted(false);
          throw new Error(
            "Collection terms changed. Review them before signing.",
          );
        }
        if (
          fresh.goalReached ||
          fresh.config.retired ||
          BigInt(fresh.now) < fresh.config.paused_until
        )
          throw new Error("The endowment is not accepting new consent.");
        const a = await common(inst, owner);
        ixs = [
          getCreateAssociatedTokenIdempotentInstruction({
            payer: signer,
            owner,
            mint: inst.dividendMint,
            ata: a.dividend_account,
            tokenProgram: inst.dividendTokenProgram,
          }),
          getCreateAssociatedTokenIdempotentInstruction({
            payer: signer,
            owner,
            mint: inst.coinMint,
            ata: a.coin_account,
            tokenProgram: inst.coinTokenProgram,
          }),
          getApproveCheckedInstruction(
            {
              source: a.dividend_account,
              mint: inst.dividendMint,
              delegate: a.authority,
              owner: signer,
              amount: (1n << 64n) - 1n,
              decimals: 6,
            },
            {
              programAddress:
                inst.dividendTokenProgram as typeof TOKEN_2022_PROGRAM_ADDRESS,
            },
          ),
        ];
        if (!fresh.landlord)
          ixs.push(await consentIx(inst, signer, "register_landlord"));
        ixs.push(await consentIx(inst, signer, "enable_collection"));
      }
      if (client.identity.address !== owner)
        throw new Error(
          "The connected wallet changed. Refresh before continuing.",
        );
      const result = await client.sendTransaction(ixs);
      setMessage(
        `Transaction submitted: ${result.context.signature}. Refresh to confirm its final state.`,
      );
      setAccepted(false);
      await refresh();
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Could not complete the request. Check transaction history before retrying.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row-body">
      <p className="small">Connected: {owner}</p>
      <div className="actions">
        <button
          className="button"
          disabled={busy}
          onClick={() => void act("stop")}
        >
          Stop collection
        </button>
        <button
          className="button"
          disabled={busy}
          onClick={() => void refresh()}
        >
          Refresh
        </button>
        <button className="button" onClick={() => disconnect()}>
          Disconnect
        </button>
      </div>
      {snapshot && (
        <>
          <p>
            Collector: <code>{snapshot.policy.collector}</code>
            <br />
            Reviewer: <code>{snapshot.policy.reviewer}</code>
          </p>
          <label>
            <input
              type="checkbox"
              checked={accepted}
              disabled={busy || !HOLD_COLLECTION_RELEASED}
              onChange={(e) => setAccepted(e.target.checked)}
            />{" "}
            I authorize collection of verified future PENIS rewards paid in
            PUMP. Collection and review depend on trusted services and can be
            wrong. Contributions are held for at least 24 hours and can be
            reclaimed before release. Approved, released funds become permanent.
            Other coins’ rewards and purchased PUMP are excluded by the worker
            policy; the contract cannot prove their origin.
          </label>
          <p className="small">
            Opting in again protects your current PUMP balance and cancels
            release of earlier pending contributions. A refund stops further
            collection until you opt in again.
          </p>
          <button
            className="button"
            disabled={busy || !accepted || !HOLD_COLLECTION_RELEASED}
            onClick={() => void act("join")}
          >
            Opt in / renew consent
          </button>
        </>
      )}
      {!HOLD_COLLECTION_RELEASED && (
        <p>
          Draft system: new enrollment and automated collection remain closed.
        </p>
      )}
      <h3>Your pending contributions</h3>
      {rows.length === 0 && (
        <p>
          No pending contributions are shown. This is not a record of funds
          already released or refunded.
        </p>
      )}
      <HoldingReceipts
        rows={rows}
        busy={busy}
        reclaim={(address) => void act("reclaim", address)}
      />
      {message && (
        <p role="status" className="small">
          {message}
        </p>
      )}
    </div>
  );
}
function Chooser({ inst }: { inst: Instance }) {
  const wallets = useWallets(client),
    connected = useConnectedWallet(client);
  const { dispatch: connect, isRunning } = useConnect(client);
  if (connected)
    return <Connected key={connected.account.address} inst={inst} />;
  return (
    <div className="row-body">
      <p>
        Connect your wallet to see and reclaim pending contributions. A wallet
        signature is required to act.
      </p>
      {wallets.length === 0 && <p>No compatible Solana wallet was found.</p>}
      {wallets.map((wallet) => (
        <button
          key={wallet.name}
          className="button"
          disabled={isRunning}
          onClick={() => connect(wallet)}
        >
          {wallet.name}
        </button>
      ))}
    </div>
  );
}
export function HoldingPanel() {
  const [inst, setInst] = useState<Instance | null | undefined>(undefined);
  useEffect(() => {
    flagshipInstance().then(setInst, () => setInst(null));
  }, []);
  if (inst === undefined) return <p>Loading…</p>;
  if (!inst)
    return (
      <p>
        The refundable collection system is a draft and has not been configured
        for launch.
      </p>
    );
  return (
    <WalletReadyGate client={client} fallback={<p>Looking for wallets…</p>}>
      <Chooser inst={inst} />
    </WalletReadyGate>
  );
}
