import { type Address } from "@solana/kit";
import { resolve } from "node:path";
import { ata, type Instance } from "../endowment.ts";
import type { WalletPayoutFeed } from "../reporter/payouts.ts";
import { classify } from "../reporter/classify.ts";
import { runWallet } from "../reporter/engine.ts";
import { withJournal } from "../reporter/journal.ts";
import { history, latestCursor, type RpcCall } from "../reporter/rpc.ts";
import { MissingPayoutEvidence, type Observation, type SourcePolicy } from "../reporter/types.ts";
import { collectIx, reviewIx, settleIx } from "./client.ts";
import { holdSnapshot, type HoldSnapshot } from "./snapshot.ts";
import {
  reconcileHistory,
  resetReviewer,
  settlementPlan,
  type ReviewedLedger,
} from "./reconcile.ts";
import { keySigner, prepare } from "./sign.ts";
import { publish, settleOutbox, signatureStatus } from "./outbox.ts";
import type { Receipt } from "./types.ts";

export type WorkerOptions = {
  rpc: RpcCall;
  rpcUrl: string;
  inst: Instance;
  directory: string;
  submit: boolean;
  keyFile?: string;
  feed: WalletPayoutFeed;
  loadFeed?: () => Promise<WalletPayoutFeed>;
  source: SourcePolicy;
  role: "collector" | "reviewer";
  beforeCollect?: (snapshot: HoldSnapshot) => Promise<void>;
  beforeRelease?: () => Promise<void>;
  observe?: (event:
    | { kind: "snapshot"; snapshot: HoldSnapshot }
    | { kind: "observations"; observations: Observation[] }
    | { kind: "review"; receipt: string; collected: string; eligible: string }
  ) => void;
};
export async function walletTick(
  o: WorkerOptions,
  owner: Address,
  receipts: { address: Address; receipt: Receipt }[],
) {
  const source = await ata(
    owner,
    o.inst.dividendMint,
    o.inst.dividendTokenProgram,
  );
  return withJournal(
    resolve(o.directory, "wallets"),
    source,
    async (journal) => {
      const snapshot = async (min: number) => {
        const value = await holdSnapshot(o.rpc, o.inst, owner, min, o.role);
        o.observe?.({ kind: "snapshot", snapshot: value });
        return value;
      };
      const batch = async (
        state: NonNullable<typeof journal.state>,
        s: HoldSnapshot,
      ) => {
        const h = await history(
          o.rpc,
          source,
          state.cursor,
          state.slot,
          s.slot,
        );
        // A long pass must see payouts captured while other wallets were read.
        // Load after history retrieval; an absent recent holder row holds the whole batch.
        const feed = o.loadFeed ? await o.loadFeed() : o.feed;
        const observations = h.transactions.map((tx) => {
          let result: Observation;
          try { result = classify(tx, source, owner, o.source, feed, s.now, state.payoutWaitUntil); }
          catch (error) {
            if (!(error instanceof MissingPayoutEvidence) || tx.blockTime === null
                || BigInt(tx.blockTime) >= (s.consent?.started_at ?? 0n)) throw error;
            // A payout before consent cannot become eligible when the API catches up.
            return { ...error.observation, kind: "uncertain" as const,
              reason: "Payout predates consent" };
          }
          if (result.payoutAttribution && tx.blockTime !== null
              && BigInt(tx.blockTime) < (s.consent?.started_at ?? 0n)) {
            // A never-eligible pre-consent receipt is not an attribution outage.
            const excluded = {...result, reason: "Payout predates consent; no new eligibility"};
            delete excluded.payoutAttribution;
            return excluded;
          }
          // Missing payout time cannot establish whether it followed consent.
          return result.kind === "reward" &&
            (tx.blockTime === null ||
              BigInt(tx.blockTime) < (s.consent?.started_at ?? 0n))
            ? {
                ...result,
                kind: "uncertain" as const,
                reason: "Unverifiable payout time relative to consent",
              }
            : result;
        });
        o.observe?.({ kind: "observations", observations });
        return { ...h, observations };
      };
      if (o.role === "collector") {
        let latest: HoldSnapshot;
        return runWallet(
          journal,
          {
            snapshot: async (min) => (latest = await snapshot(min)),
            cursor: (s) => latestCursor(o.rpc, source, s.slot),
            observations: async (state, s) => batch(state, s as HoldSnapshot),
            prepare: async (s, amount, evidenceHash) => {
              if (s !== latest || !latest.consent || !latest.pool)
                throw new Error("Signing snapshot changed");
              await o.beforeCollect?.(latest);
              const signer = await keySigner(o.keyFile);
              if (signer.address !== latest.policy.collector)
                throw new Error("Wrong collector key");
              const expiresAt = s.now + 45;
              const ix = await collectIx(
                o.inst,
                owner,
                latest.config.pool,
                latest.pool,
                signer,
                latest.consent.next_nonce,
                {
                  consent_epoch: latest.consent.epoch,
                  expected_balance: BigInt(s.balance),
                  amount,
                  valid_until: BigInt(expiresAt),
                  evidence_hash: Uint8Array.from(
                    Buffer.from(evidenceHash, "hex"),
                  ),
                },
              );
              // Engine's nonce denotes the expected post-execution counter.
              return prepare(o.rpcUrl, signer, [ix], s.slot, {
                nonce: (latest.consent.next_nonce + 1n).toString(),
                amount: amount.toString(),
                expiresAt,
                evidenceHash,
              });
            },
            status: (sig) => signatureStatus(o.rpc, sig),
            height: async () =>
              BigInt(
                await o.rpc<number>("getBlockHeight", [
                  { commitment: "finalized" },
                ]),
              ),
            publish: async (wire) => {
              if (o.beforeCollect) await o.beforeCollect(await snapshot(latest.slot));
              return publish(o.rpc, wire);
            },
          },
          o.submit,
        );
      }
      let s = await snapshot(journal.state?.slot ?? 0);
      let evidenceRetry: MissingPayoutEvidence | undefined;
      let waitStartedAt: number | undefined;
      let waitSeconds: number | undefined;
      if (!journal.state || journal.state.binding !== s.binding) {
        await resetReviewer(
          journal,
          s,
          await latestCursor(o.rpc, source, s.slot),
        );
      } else {
        try {
          const h = await batch(journal.state, s);
          await reconcileHistory(
            journal,
            s,
            h,
            h.observations,
            receipts,
            o.inst.program,
          );
        } catch (error) {
          if (error instanceof MissingPayoutEvidence) {
            evidenceRetry = error;
            const retryUntil = Math.min(journal.state!.payoutWaitUntil ?? Infinity, error.retryUntil);
            waitStartedAt = journal.state!.payoutWaitStartedAt ?? s.now;
            waitSeconds = Math.max(0, s.now - waitStartedAt);
            if (journal.state!.payoutWaitUntil !== retryUntil || journal.state!.payoutWaitStartedAt === undefined)
              await journal.save({...journal.state!, payoutWaitUntil: retryUntil, payoutWaitStartedAt: waitStartedAt},
                "Awaiting payout attribution; reviewer history retained",
                {signature: error.observation.signature, retryUntil, waitStartedAt});
          }
          else {
            await resetReviewer(journal, s, await latestCursor(o.rpc, source, s.slot));
            throw error; // no signing in a tick with a history failure
          }
        }
      }
      const outcomes = [];
      for (const entry of receipts) {
        const decision = (journal.state as ReviewedLedger)?.reviews?.[
          entry.address
        ];
        // A fresh finalized snapshot catches intervening revocation/goal/pause.
        s = await snapshot(s.slot);
        if (decision) o.observe?.({
          kind: "review", receipt: entry.address,
          collected: entry.receipt.amount.toString(), eligible: decision.amount,
        });
        const planned = settlementPlan(entry.receipt, s, decision);
        // Missing attribution never permits new clearance, but chain-driven
        // refunds and reconciliation of already signed settlements must continue.
        const action = evidenceRetry && planned === "clear" ? "wait" : planned;
        if ((action === "wait" && !evidenceRetry) || !o.submit) {
          outcomes.push({ receipt: entry.address, action });
          continue;
        }
        let releaseBlocked = false;
        const beforeRelease = async () => {
          if (action !== "clear") return;
          try { await o.beforeRelease?.(); }
          catch (error) { releaseBlocked = true; throw error; }
        };
        const result = await withJournal(
          resolve(o.directory, "settlements"),
          entry.address,
          async (outbox) => {
            if (action === "wait" && !outbox.state?.pending) return "waiting_for_payout";
            return settleOutbox(outbox, o.rpc, entry.address, async () => {
              if (action === "wait") throw evidenceRetry;
              // Prior positive decisions do not override a newly invalid feed.
              // The outbox first reconciles any existing signed transaction.
              await beforeRelease();
              const signer = await keySigner(o.keyFile);
              if (signer.address !== s.policy.reviewer)
                throw new Error("Wrong reviewer key");
              const ixs = [];
              if (action === "clear" && !entry.receipt.reviewed)
                ixs.push(
                  await reviewIx(
                    o.inst,
                    entry.receipt,
                    signer,
                    BigInt(decision!.amount),
                    Uint8Array.from(Buffer.from(decision!.evidenceHash, "hex")),
                  ),
                );
              ixs.push(
                await settleIx(
                  o.inst,
                  entry.receipt,
                  signer,
                  action === "clear",
                ),
              );
              return prepare(o.rpcUrl, signer, ixs, s.slot, {
                nonce: entry.receipt.nonce.toString(),
                amount: entry.receipt.amount.toString(),
                expiresAt: s.now + 60,
                evidenceHash: decision?.evidenceHash ?? "0".repeat(64),
              });
            }, beforeRelease);
          },
        ).catch((error) => {
          if (!releaseBlocked) throw error;
          // A release-only outage must not prevent later refunds. Signed bytes
          // remain durable if the feed failed just before broadcast.
          return "blocked";
        });
        outcomes.push({ receipt: entry.address, action, result });
      }
      return evidenceRetry
        ? { status: "awaiting_payout", reason: evidenceRetry.message, retryUntil: evidenceRetry.retryUntil, waitStartedAt, waitSeconds, outcomes }
        : { status: "reviewed", outcomes };
    },
  );
}
