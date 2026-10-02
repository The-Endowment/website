import { type Address } from "@solana/kit";
import { resolve } from "node:path";
import { ata, type Instance } from "../endowment.ts";
import { classify } from "../reporter/classify.ts";
import { runWallet } from "../reporter/engine.ts";
import { withJournal } from "../reporter/journal.ts";
import { history, latestCursor, type RpcCall } from "../reporter/rpc.ts";
import type { Distribution, SourcePolicy } from "../reporter/types.ts";
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
  feed: Map<string, Distribution>;
  source: SourcePolicy;
  role: "collector" | "reviewer";
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
      const snapshot = (min: number) => holdSnapshot(o.rpc, o.inst, owner, min, o.role === "collector");
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
        const observations = h.transactions.map((tx) => {
          const result = classify(tx, source, owner, o.source, o.feed);
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
            publish: (wire) => publish(o.rpc, wire),
          },
          o.submit,
        );
      }
      let s = await snapshot(journal.state?.slot ?? 0);
      if (!journal.state || journal.state.binding !== s.binding || !s.active) {
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
          await resetReviewer(
            journal,
            s,
            await latestCursor(o.rpc, source, s.slot),
          );
          throw error; // no signing in a tick with a history failure
        }
      }
      const outcomes = [];
      for (const entry of receipts) {
        const decision = (journal.state as ReviewedLedger)?.reviews?.[
          entry.address
        ];
        // A fresh finalized snapshot catches intervening revocation/goal/pause.
        s = await snapshot(s.slot);
        const action = settlementPlan(entry.receipt, s, decision);
        if (action === "wait" || !o.submit) {
          outcomes.push({ receipt: entry.address, action });
          continue;
        }
        const result = await withJournal(
          resolve(o.directory, "settlements"),
          entry.address,
          async (outbox) =>
            settleOutbox(outbox, o.rpc, entry.address, async () => {
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
            }),
        );
        outcomes.push({ receipt: entry.address, action, result });
      }
      return { status: "reviewed", outcomes };
    },
  );
}
