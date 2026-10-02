import { createHash } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { raw, type Ledger } from "./types.ts";

type Entry = { previous: string; hash: string; body: string };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export type Journal = { state: Ledger | null; hash: string; save: (state: Ledger, reason: string, evidence?: unknown) => Promise<void> };

function validate(state: Ledger) {
  if (state.version !== 1 || typeof state.binding !== "string" || !Number.isSafeInteger(state.slot)
      || state.slot < 0 || (state.cursor !== null && typeof state.cursor !== "string")) throw new Error("Invalid journal state");
  if (raw(state.eligible) > raw(state.balance)) throw new Error("Invalid journal eligibility");
  if (state.settled) {
    if (state.pending || !Number.isSafeInteger(state.settled.slot) || state.settled.slot < state.slot) throw new Error("Invalid settled submission checkpoint");
    raw(state.settled.nonce);
  }
  if (state.pending) {
    raw(state.pending.amount); raw(state.pending.nonce); raw(state.pending.lastValidBlockHeight);
    if (![state.pending.signature, state.pending.wire, state.pending.evidenceHash].every((x) => typeof x === "string" && x.length > 0)
        || !Number.isSafeInteger(state.pending.expiresAt)) throw new Error("Invalid prepared transaction");
  }
}

/** Local single-writer durable log. A truncated/corrupt log or stale lock stops
 * signing; operators must reconcile it, never delete it and resume collections. */
export async function withJournal<T>(directory: string, account: string, run: (journal: Journal) => Promise<T>): Promise<T> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(account)) throw new Error("Invalid journal account");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, `${account}.lock`);
  await mkdir(lock);
  try {
    const path = join(directory, `${account}.jsonl`);
    let contents = "";
    try { contents = await readFile(path, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (contents && !contents.endsWith("\n")) throw new Error("Truncated reporter journal; reconcile before resuming");
    let state: Ledger | null = null, hash = "0".repeat(64);
    for (const line of contents.trimEnd().split("\n").filter(Boolean)) {
      const entry = JSON.parse(line) as Entry;
      if (entry.previous !== hash || digest(entry.previous + entry.body) !== entry.hash) throw new Error("Reporter journal hash mismatch");
      const body = JSON.parse(entry.body) as { state: Ledger };
      validate(body.state); state = body.state; hash = entry.hash;
    }
    const journal: Journal = { state, hash, async save(next, reason, evidence = null) {
      validate(next);
      const body = JSON.stringify({ at: new Date().toISOString(), reason, evidence, state: next });
      const entry = { previous: journal.hash, hash: digest(journal.hash + body), body };
      const handle = await open(path, "a", 0o600);
      try { await handle.writeFile(JSON.stringify(entry) + "\n"); await handle.sync(); } finally { await handle.close(); }
      // Ensure first creation's directory entry is durable as well as contents.
      const dir = await open(directory, "r"); try { await dir.sync(); } finally { await dir.close(); }
      journal.state = next; journal.hash = entry.hash;
    } };
    return await run(journal);
  } finally { await rm(lock, { recursive: true }); }
}
