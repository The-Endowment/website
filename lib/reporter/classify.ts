import { raw, type Distribution, type Observation, type ParsedInstruction, type ParsedTransaction, type SourcePolicy } from "./types.ts";

/** Only the public distribution feed is used; malformed/conflicting records fail closed. */
export function distributions(input: unknown): Map<string, Distribution> {
  const entries = (input as { data?: { recentDistributions?: unknown } })?.data?.recentDistributions;
  if (!Array.isArray(entries)) throw new Error("Missing recent distribution records");
  const records = new Map<string, Distribution>();
  for (const value of entries) {
    const entry = value as Distribution;
    if (!entry || ![entry.signature, entry.mint, entry.quoteMint].every((x) => typeof x === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(x))) {
      throw new Error("Malformed distribution identity");
    }
    raw(entry.amountRaw);
    const previous = records.get(entry.signature);
    if (previous && (previous.mint !== entry.mint || previous.quoteMint !== entry.quoteMint || previous.amountRaw !== entry.amountRaw)) {
      throw new Error("Conflicting distribution record");
    }
    records.set(entry.signature, entry);
  }
  return records;
}

type Transfer = { source: string; destination: string; authority: string; amount: bigint; mint?: string };
function transfer(ix: ParsedInstruction): Transfer | null {
  const parsed = ix.parsed;
  if (!parsed || !["transfer", "transferChecked", "transferCheckedWithFee"].includes(parsed.type)) return null;
  const info = parsed.info;
  if (![info.source, info.destination, info.authority].every((x) => typeof x === "string")) return null;
  const value = info.amount ?? (info.tokenAmount as { amount?: unknown } | undefined)?.amount;
  return { source: String(info.source), destination: String(info.destination), authority: String(info.authority),
    amount: raw(value), mint: typeof info.mint === "string" ? info.mint : undefined };
}

/** The caller obtains this transaction from a finalized RPC lookup. No API
 * estimate or balance delta alone can create reward eligibility. */
export function classify(tx: ParsedTransaction, account: string, owner: string, policy: SourcePolicy, feed: Map<string, Distribution>): Observation {
  const signature = tx.transaction.signatures[0];
  const base = { signature, slot: tx.slot, before: "0", after: "0", amount: "0" };
  const uncertain = (reason: string): Observation => ({ ...base, kind: "uncertain", reason });
  if (!tx.meta) return uncertain("Missing transaction metadata");
  const keys = tx.transaction.message.accountKeys;
  const index = keys.findIndex((key) => key.pubkey === account);
  const pre = tx.meta.preTokenBalances.find((b) => b.accountIndex === index);
  const post = tx.meta.postTokenBalances.find((b) => b.accountIndex === index);
  if (index < 0 || !pre || !post || [pre, post].some((b) => b.mint !== policy.mint || b.owner !== owner
      || b.programId !== policy.tokenProgram || b.uiTokenAmount.decimals !== 6)) {
    return uncertain("Account created, closed, changed owner, or has unverifiable token identity");
  }
  base.before = raw(pre.uiTokenAmount.amount).toString(); base.after = raw(post.uiTokenAmount.amount).toString();
  if (tx.meta.err !== null) return { ...base, kind: "failed", reason: "Failed transaction" };
  const all = [...tx.transaction.message.instructions, ...(tx.meta.innerInstructions ?? []).flatMap((x) => x.instructions)];
  let incoming = 0n, outgoing = 0n, approvedIncoming = 0n, batchTotal = 0n;
  try {
    for (const ix of all) {
      if (ix.programId !== policy.tokenProgram) continue;
      const move = transfer(ix);
      const touches = ix.accounts?.includes(account) || (ix.parsed && Object.values(ix.parsed.info).includes(account));
      if (!move) {
        if (touches || !ix.parsed) return uncertain("Unrecognized token instruction or authorization change");
        continue;
      }
      const approved = move.source === policy.source && move.authority === policy.authority
        && (!move.mint || move.mint === policy.mint)
        && keys.some((key) => key.pubkey === policy.authority && key.signer);
      if (approved) batchTotal += move.amount;
      if (move.source === account) outgoing += move.amount;
      if (move.destination === account) {
        if (move.mint && move.mint !== policy.mint) return uncertain("Transfer mint mismatch");
        incoming += move.amount;
        if (approved) approvedIncoming += move.amount;
      }
    }
  } catch { return uncertain("Unparseable token amount"); }
  const delta = raw(base.after) - raw(base.before);
  if (incoming > 0n && outgoing > 0n) return uncertain("Mixed inflows and outflows");
  if (outgoing > 0n) {
    if (delta !== -outgoing) return uncertain("Outflow does not reconcile to token balances");
    return { ...base, kind: "outflow", amount: outgoing.toString(), reason: "Outgoing PUMP consumes eligible rewards first" };
  }
  if (delta < 0n || delta > incoming || (incoming === 0n && delta !== 0n)) return uncertain("Unexplained token balance change");
  const record = feed.get(signature);
  if (incoming > 0n && incoming === approvedIncoming && delta > 0n && record?.quoteMint === policy.mint
      && raw(record.amountRaw) === batchTotal) {
    return { ...base, kind: "reward", amount: delta.toString(), reason: "Finalized distributor transfer matches public payout record" };
  }
  return { ...base, kind: "other", reason: "Purchase, ordinary receipt, or unmatched payout; no new eligibility" };
}
