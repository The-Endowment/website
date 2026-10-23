import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { Address } from "@solana/kit";
import type { Journal } from "../reporter/journal.ts";
import { withJournal } from "../reporter/journal.ts";
import { HistoryAdvancedError, latestCursor } from "../reporter/rpc.ts";
import { authorizeCollectionIx, holdPda } from "./client.ts";
import { authorizationBinding, validPermit, type HoldSnapshot } from "./snapshot.ts";
import type { ReviewedLedger } from "./reconcile.ts";
import { settleOutbox } from "./outbox.ts";
import { keySigner, prepare } from "./sign.ts";
import type { WorkerOptions } from "./worker.ts";

class AuthorizationChanged extends Error {
  constructor() { super("State or history changed before reviewer authorization; retry this wallet"); }
}

/** Authorize only independently reconciled rewards. No token moves here.
 * Keep a separate durable outbox: a timeout must not produce a new grant while
 * the old signed transaction could still land. Never backfill a lost journal. */
export async function authorizeRewards(
  o: WorkerOptions, owner: Address, source: Address, journal: Journal,
  initial: HoldSnapshot, snapshot: (min: number) => Promise<HoldSnapshot>,
  evidencePending: boolean,
) {
  const permitKey = await holdPda(o.inst, "permit", owner);
  return withJournal(resolve(o.directory, "permits"), permitKey, async outbox => {
    const fresh = async () => {
      const s = await snapshot(initial.slot), state = journal.state as ReviewedLedger | null;
      if (evidencePending || !state || !s.tracked || !s.active || !s.consent
          || s.binding !== state.binding || s.balance !== state.balance
          || state.authorizationBinding !== authorizationBinding(s)
          || s.nonce !== initial.nonce)
        return null;
      try {
        if (await latestCursor(o.rpc, source, s.slot) !== state.cursor) return null;
      } catch (error) {
        if (error instanceof HistoryAdvancedError) return null;
        throw error; // RPC failures still stop grants; do not hide an evidence gap.
      }
      return s;
    };
    const s = await fresh();
    let amount = BigInt(journal.state?.eligible ?? 0);
    if (s) for (const cap of [s.balance, s.allowance, s.capacity]) amount = amount < BigInt(cap) ? amount : BigInt(cap);
    const build = async () => {
      if (!s) throw new AuthorizationChanged();
      await o.beforeAuthorize?.(s);
      const current = await fresh();
      if (!current || [current.balance, current.allowance, current.capacity].some(cap => BigInt(cap) < amount))
        throw new AuthorizationChanged();
      const signer = await keySigner(o.keyFile);
      if (signer.address !== current.policy.reviewer) throw new Error("Wrong reviewer key");
      const expiresAt = current.now + 600;
      const evidenceHash = createHash("sha256").update(journal.hash)
        .update(JSON.stringify({ binding: current.binding, cursor: journal.state!.cursor, nonce: current.nonce, amount: amount.toString() })).digest("hex");
      const ix = await authorizeCollectionIx(o.inst, owner, signer, current.consent!.next_nonce, {
        consent_epoch: current.consent!.epoch, expected_balance: BigInt(current.balance), amount,
        valid_until: BigInt(expiresAt), evidence_hash: [...Buffer.from(evidenceHash, "hex")],
      }, {
        collector: current.policy.collector, reviewer: current.policy.reviewer,
        count_at: current.config.last_count_at, refresher_epoch: current.config.refresher_epoch,
        pause_started_at: current.config.pause_started_at, observation_day: BigInt(Math.floor(current.now / 86400)),
      });
      return prepare(o.rpcUrl, signer, [ix], current.slot, {
        nonce: current.nonce, amount: amount.toString(), expiresAt, evidenceHash,
      });
    };
    const beforePublish = async () => {
      let current = await fresh();
      if (!current) throw new AuthorizationChanged();
      await o.beforeAuthorize?.(current);
      current = await fresh();
      if (!current || [current.balance, current.allowance, current.capacity].some(cap => BigInt(cap) < amount))
        throw new AuthorizationChanged();
    };
    // Recovery is allowed even when consent is off or the feed failed. The
    // outbox resolves the prior outcome without signing or resubmitting it.
    if (outbox.state?.pending)
      return { status: await settleOutbox(outbox, o.rpc, permitKey, build, beforePublish) };
    if (!s) return { status: evidencePending || !initial.active ? "idle" : "retry" };
    const currentPermit = validPermit(s.permit, { ...s, balance: BigInt(s.balance) });
    if (currentPermit && s.permit!.amount === amount)
      return { status: "authorized", amount: amount.toString() };
    // A spend followed by a purchase can restore the same balance while
    // reducing eligibility. Replace an oversized grant, including with zero.
    // Revoke even if a changed balance currently blocks the grant, or less than
    // 45 seconds remain. A subsequent purchase could restore its old balance.
    const livePermit = s.permit && validPermit(s.permit, { ...s, balance: s.permit.expected_balance }, 0);
    if (amount === 0n && !livePermit) return { status: "idle" };
    if (!o.submit || !o.authorizeCollections) return { status: "dry_run", amount: amount.toString() };
    try {
      return { status: await settleOutbox(outbox, o.rpc, permitKey, build, beforePublish), amount: amount.toString() };
    } catch (error) {
      if (!(error instanceof AuthorizationChanged)) throw error;
      // If signing already happened, retain the exact bytes in the outbox.
      // Reconcile them before another grant, even though this pass did not send.
      return { status: "retry", reason: error.message };
    }
  });
}
