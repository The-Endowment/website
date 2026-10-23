import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { Address } from "@solana/kit";
import type { Journal } from "../reporter/journal.ts";
import { withJournal } from "../reporter/journal.ts";
import { latestCursor } from "../reporter/rpc.ts";
import { authorizeCollectionIx, holdPda } from "./client.ts";
import { validPermit, type HoldSnapshot } from "./snapshot.ts";
import { settleOutbox } from "./outbox.ts";
import { keySigner, prepare } from "./sign.ts";
import type { WorkerOptions } from "./worker.ts";

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
      const s = await snapshot(initial.slot), state = journal.state;
      if (evidencePending || !state || !s.tracked || !s.active || !s.consent
          || s.binding !== state.binding || s.balance !== state.balance
          || s.nonce !== initial.nonce || await latestCursor(o.rpc, source, s.slot) !== state.cursor)
        return null;
      return s;
    };
    const s = await fresh();
    let amount = BigInt(journal.state?.eligible ?? 0);
    if (s) for (const cap of [s.balance, s.allowance, s.capacity]) amount = amount < BigInt(cap) ? amount : BigInt(cap);
    const build = async () => {
      if (!s || amount === 0n) throw new Error("No reconciled reward authorization available");
      await o.beforeAuthorize?.(s);
      const current = await fresh();
      if (!current || [current.balance, current.allowance, current.capacity].some(cap => BigInt(cap) < amount))
        throw new Error("State or history changed before reviewer authorization");
      const signer = await keySigner(o.keyFile);
      if (signer.address !== current.policy.reviewer) throw new Error("Wrong reviewer key");
      const expiresAt = current.now + 600;
      const evidenceHash = createHash("sha256").update(journal.hash)
        .update(JSON.stringify({ binding: current.binding, cursor: journal.state!.cursor, nonce: current.nonce, amount: amount.toString() })).digest("hex");
      const ix = await authorizeCollectionIx(o.inst, owner, signer, current.consent!.next_nonce, {
        consent_epoch: current.consent!.epoch, expected_balance: BigInt(current.balance), amount,
        valid_until: BigInt(expiresAt), evidence_hash: [...Buffer.from(evidenceHash, "hex")],
      });
      return prepare(o.rpcUrl, signer, [ix], current.slot, {
        nonce: current.nonce, amount: amount.toString(), expiresAt, evidenceHash,
      });
    };
    const beforePublish = async () => {
      const current = await fresh();
      if (!current) throw new Error("State or history changed before reviewer authorization broadcast");
      await o.beforeAuthorize?.(current);
    };
    // Recovery is allowed even when consent is off or the feed failed. The
    // outbox resolves the prior outcome without signing or resubmitting it.
    if (outbox.state?.pending)
      return { status: await settleOutbox(outbox, o.rpc, permitKey, build, beforePublish) };
    if (!s || amount === 0n) return { status: "idle" };
    if (validPermit(s.permit, { ...s, balance: BigInt(s.balance) }) && s.permit!.amount >= amount)
      return { status: "authorized", amount: amount.toString() };
    if (!o.submit || !o.authorizeCollections) return { status: "dry_run", amount: amount.toString() };
    return { status: await settleOutbox(outbox, o.rpc, permitKey, build, beforePublish), amount: amount.toString() };
  });
}
