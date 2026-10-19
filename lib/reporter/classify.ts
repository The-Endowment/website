import { archiveGraceElapsed, VERIFICATION_VERSION, walletPayoutKey, type WalletPayoutFeed } from "./payouts.ts";
import { MissingPayoutEvidence, PAYOUT_EVIDENCE_WAIT_SECONDS, raw, type Distribution, type Observation, type ParsedInstruction, type ParsedTransaction, type SourcePolicy } from "./types.ts";

/** A transaction can distribute rewards for several coins. Scope before checking
 * conflicts so unrelated coin records cannot collide with the selected payout. */
export function distributions(input: unknown, scope?: Pick<Distribution, "mint" | "quoteMint">): Map<string, Distribution> {
  const entries = (input as { data?: { recentDistributions?: unknown } })?.data?.recentDistributions;
  if (!Array.isArray(entries)) throw new Error("Missing recent distribution records");
  const records = new Map<string, Distribution>();
  for (const value of entries) {
    const entry = value as Distribution;
    if (!entry || ![entry.signature, entry.mint, entry.quoteMint].every((x) => typeof x === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(x))) {
      throw new Error("Malformed distribution identity");
    }
    raw(entry.amountRaw);
    if (scope && (entry.mint !== scope.mint || entry.quoteMint !== scope.quoteMint)) continue;
    const previous = records.get(entry.signature);
    if (previous && (previous.mint !== entry.mint || previous.quoteMint !== entry.quoteMint || previous.amountRaw !== entry.amountRaw)) {
      throw new Error("Conflicting distribution record");
    }
    records.set(entry.signature, { signature: entry.signature, mint: entry.mint,
      quoteMint: entry.quoteMint, amountRaw: entry.amountRaw });
  }
  return records;
}

type Transfer = { source: string; destination: string; authority: string; amount: bigint; mint?: string; decimals?: number };
const transferTypes = ["transfer", "transferChecked", "transferCheckedWithFee"];
const touches = (ix: ParsedInstruction, account: string): boolean => Boolean(
  ix.accounts?.includes(account) || (ix.parsed && Object.values(ix.parsed.info).includes(account)));
function transfer(ix: ParsedInstruction): Transfer | null {
  const parsed = ix.parsed;
  if (!parsed || !transferTypes.includes(parsed.type)) return null;
  const info = parsed.info;
  if (![info.source, info.destination, info.authority].every((x) => typeof x === "string"))
    throw new Error("Missing transfer identity");
  const checked = parsed.type !== "transfer";
  const token = info.tokenAmount as { amount?: unknown; decimals?: unknown } | undefined;
  if (checked && (typeof info.mint !== "string" || !token || !Number.isInteger(token.decimals)
      || Number(token.decimals) < 0 || Number(token.decimals) > 255)) throw new Error("Invalid checked transfer");
  const amount = raw(checked ? token!.amount : info.amount);
  if (checked && info.amount !== undefined && raw(info.amount) !== amount) throw new Error("Conflicting transfer amount");
  return { source: String(info.source), destination: String(info.destination), authority: String(info.authority),
    amount, mint: checked ? String(info.mint) : undefined, decimals: checked ? Number(token!.decimals) : undefined };
}

/** End-of-transaction owner metadata is usable only when both sides agree and
 * no lifecycle/authority instruction touches this account. One-sided metadata
 * (creation/closure) deliberately cannot prove ownership at transfer time. */
function stableToken(tx: ParsedTransaction, account: string, policy: SourcePolicy) {
  const keys = tx.transaction.message.accountKeys;
  const index = keys.findIndex((key) => key.pubkey === account);
  if (index < 0 || keys.filter((key) => key.pubkey === account).length !== 1) throw new Error("Ambiguous account index");
  const pres = tx.meta!.preTokenBalances.filter((b) => b.accountIndex === index);
  const posts = tx.meta!.postTokenBalances.filter((b) => b.accountIndex === index);
  if (pres.length !== 1 || posts.length !== 1) throw new Error("Missing or duplicate token identity");
  const pre = pres[0], post = posts[0];
  if ([pre, post].some((b) => b.mint !== policy.mint || b.programId !== policy.tokenProgram
      || typeof b.owner !== "string" || !b.owner || b.uiTokenAmount.decimals !== 6)
      || pre.owner !== post.owner) throw new Error("Unstable token identity");
  raw(pre.uiTokenAmount.amount); raw(post.uiTokenAmount.amount);
  return { pre, post, owner: pre.owner };
}

/** The runtime cannot change an account a transaction lists only as read-only,
 * so its balance, owner and authority are unchanged and it carries no history.
 * Endowment counts and refreshes read every landlord's PUMP account this way.
 * Missing writability metadata, or any writable listing, is never skipped. */
export function readOnlyReference(tx: ParsedTransaction, account: string): boolean {
  const entries = tx.transaction.message.accountKeys.filter((key) => key.pubkey === account);
  return entries.length > 0 && entries.every((key) => key.writable === false);
}

/** Finalized chain evidence proves source, owner and net receipt. The API
 * attributes the generating coin; it cannot authorize an API-only amount. */
export function classify(tx: ParsedTransaction, account: string, owner: string, policy: SourcePolicy, feed: WalletPayoutFeed, now = Math.floor(Date.now() / 1000), batchWaitUntil?: number): Observation {
  const signature = tx.transaction.signatures[0];
  const base = { signature, slot: tx.slot, receivedAt: tx.blockTime, before: "0", after: "0", amount: "0" };
  const uncertain = (reason: string): Observation => ({ ...base, kind: "uncertain", reason });
  if (!tx.meta) return uncertain("Missing transaction metadata");
  try {
    const target = stableToken(tx, account, policy);
    if (target.owner !== owner) return uncertain("Wrong target owner");
    base.before = target.pre.uiTokenAmount.amount; base.after = target.post.uiTokenAmount.amount;
  } catch { return uncertain("Account created, closed, changed owner, or has unverifiable token identity"); }
  if (tx.meta.err !== null) return { ...base, kind: "failed", reason: "Failed transaction" };
  const keys = tx.transaction.message.accountKeys;
  const all = [...tx.transaction.message.instructions, ...(tx.meta.innerInstructions ?? []).flatMap((x) => x.instructions)];
  let incoming = 0n, outgoing = 0n, approvedIncoming = 0n, ownerGross = 0n, alternateAccount = false;
  const protectedAccounts = new Set([account]);
  try {
    for (const ix of all) {
      if (ix.programId !== policy.tokenProgram) continue;
      const move = transfer(ix);
      if (!move) {
        if (!ix.parsed || touches(ix, account)) return uncertain("Unrecognized token instruction or authorization change");
        continue;
      }
      if ((move.source === account || move.destination === account)
          && move.mint !== undefined && (move.mint !== policy.mint || move.decimals !== 6))
        return uncertain("Transfer mint or decimals mismatch");
      let approved = false;
      if (move.source === policy.source && (move.mint === undefined || move.mint === policy.mint)) {
        protectedAccounts.add(move.source);
        // Inspect every fixed-source PUMP payout, including those to other
        // accounts. A delegate/unsupported authority cannot hide owner gross.
        if (move.authority !== policy.authority || !keys.some((key) => key.pubkey === policy.authority && key.signer))
          return uncertain("Unsupported distributor authority");
        if (move.mint === undefined) {
          stableToken(tx, move.source, policy);
        } else if (move.decimals !== 6) return uncertain("Distributor decimals mismatch");
        const destination = stableToken(tx, move.destination, policy);
        protectedAccounts.add(move.destination);
        approved = true;
        if (destination.owner === owner) {
          ownerGross += move.amount; raw(ownerGross.toString());
          if (move.amount > 0n && move.destination !== account) alternateAccount = true;
        }
      }
      if (move.source === account) outgoing += move.amount;
      if (move.destination === account) {
        incoming += move.amount;
        if (approved) approvedIncoming += move.amount;
      }
    }
    // Stable pre/post owners alone do not catch setAuthority-and-restore, or
    // close/reinitialize. Reject changes even on OTHER payout destinations.
    for (const ix of all) {
      if (ix.programId === policy.tokenProgram && (!ix.parsed || !transferTypes.includes(ix.parsed.type))
          && [...protectedAccounts].some((key) => touches(ix, key)))
        return uncertain("Payout destination lifecycle or authority changed");
    }
  } catch { return uncertain("Unverifiable payout instruction or destination identity"); }
  const delta = raw(base.after) - raw(base.before);
  if (incoming > 0n && outgoing > 0n) return uncertain("Mixed inflows and outflows");
  if (outgoing > 0n) {
    if (delta !== -outgoing) return uncertain("Outflow does not reconcile to token balances");
    return { ...base, kind: "outflow", amount: outgoing.toString(), reason: "Outgoing PUMP consumes eligible rewards first" };
  }
  if (delta < 0n || delta > incoming || (incoming === 0n && delta !== 0n)) return uncertain("Unexplained token balance change");
  if (policy.rewardMint && feed?.version === VERIFICATION_VERSION && feed.mint === policy.rewardMint
      && feed.quoteMint === policy.mint && feed.records instanceof Map) {
    const record = feed.records.get(walletPayoutKey(signature, owner, policy.mint));
    const retryUntil = Number.isSafeInteger(tx.blockTime)
      ? Math.min(tx.blockTime! + PAYOUT_EVIDENCE_WAIT_SECONDS, batchWaitUntil ?? Infinity) : 0;
    // Only an absent exact row may be retried. Conflicting amounts/identities
    // remain conservative exclusions, and no API timestamp can extend the wait.
    if (!record && !alternateAccount && incoming > 0n && incoming === approvedIncoming
        && incoming === ownerGross && delta > 0n && Number.isSafeInteger(now)
        && Number.isSafeInteger(tx.blockTime) && tx.blockTime! >= 0 && tx.blockTime! <= now) {
      // A real expired wait must remain observable even if capture has just
      // recovered. Old receipts first seen after catch-up need not start a wait.
      if (!(batchWaitUntil !== undefined && now >= batchWaitUntil)
          && archiveGraceElapsed(feed, tx.blockTime!, now))
        return { ...base, kind: "other", payoutAttribution: "covered_absent",
          reason: "Holder row absent after completed-archive grace; unverified receipt excluded" };
      if (now < retryUntil)
        throw new MissingPayoutEvidence({ ...base, kind: "other", reason: "Holder payout evidence pending" }, retryUntil);
      return { ...base, kind: "other", payoutAttribution: "expired",
        reason: "Holder payout evidence deadline expired; unverified receipt excluded" };
    }
    if (record && record.signature === signature && record.holder === owner && record.assetMint === policy.mint
        && !alternateAccount && incoming > 0n && incoming === approvedIncoming && incoming === ownerGross
        && delta > 0n && raw(record.amountRaw) === ownerGross) {
      return { ...base, kind: "reward", amount: delta.toString(), reason: "Finalized wallet transfer matches scoped holder payout",
        payoutEvidence: { version: VERIFICATION_VERSION, mint: policy.rewardMint, wallet: owner, signature,
          assetMint: policy.mint, apiGross: record.amountRaw, targetAccount: account,
          ownerGross: ownerGross.toString(), creditedNet: delta.toString(), createdAt: record.createdAt } };
    }
  }
  return { ...base, kind: "other", reason: "Purchase, ordinary receipt, or unmatched wallet payout; no new eligibility" };
}
