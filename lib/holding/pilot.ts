import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { address } from "@solana/kit";
import type { Instance } from "../endowment.ts";
import { raw } from "../reporter/types.ts";
import type { HoldSnapshot } from "./snapshot.ts";
import type { Receipt } from "./types.ts";
import type { LaunchControls } from "./operations.ts";

type Role = "collector" | "reviewer";
export type PilotRequest =
  | { role: "collector"; owner: string; consentEpoch: string; nonce: string; maxAmount: string }
  | { role: "reviewer"; receipt: string; maxAmount: string };
export type PilotLimit = PilotRequest & { version: 1; program: string; config: string };
export const PILOT_LIMIT_FILE = "founder-test.json";

function validateRequest(request: PilotRequest) {
  raw(request.maxAmount);
  if (request.role === "collector") {
    address(request.owner);
    if (raw(request.maxAmount) === 0n || raw(request.consentEpoch) === 0n
        || raw(request.nonce) === (1n << 64n) - 1n)
      throw new Error("Collection pilot needs a positive cap/consent epoch and an incrementable nonce");
  } else if (request.role === "reviewer") address(request.receipt);
  else throw new Error("Invalid pilot role");
}

/** Reject misspelled, duplicate and partially supplied limits; never silently run uncapped. */
export function workerArgs(args: string[]): { role: Role; mode?: "founders" | "public"; submit: boolean; pilot?: PilotRequest } {
  const { values, tokens } = parseArgs({ args, allowPositionals: false, tokens: true, options: {
    role: { type: "string" }, mode: { type: "string" }, submit: { type: "boolean", default: false },
    "collection-cap-raw": { type: "string" }, "pilot-owner": { type: "string" },
    "pilot-consent-epoch": { type: "string" }, "pilot-nonce": { type: "string" },
    "approval-cap-raw": { type: "string" }, "pilot-receipt": { type: "string" },
  } });
  const names = tokens.filter(t => t.kind === "option").map(t => t.name);
  if (new Set(names).size !== names.length) throw new Error("Duplicate worker option");
  if (values.role !== "collector" && values.role !== "reviewer") throw new Error("Use --role=collector or --role=reviewer");
  if (values.mode !== undefined && values.mode !== "founders" && values.mode !== "public")
    throw new Error("Collection mode must be founders or public");
  const collection = [values["collection-cap-raw"], values["pilot-owner"], values["pilot-consent-epoch"], values["pilot-nonce"]];
  const review = [values["approval-cap-raw"], values["pilot-receipt"]];
  let pilot: PilotRequest | undefined;
  if (collection.some(v => v !== undefined)) {
    if (values.role !== "collector" || values.mode !== "founders" || collection.some(v => v === undefined)
        || review.some(v => v !== undefined)) throw new Error("Collection pilot requires founders mode, owner, consent epoch, nonce and raw cap only");
    pilot = { role: "collector", owner: values["pilot-owner"]!, consentEpoch: values["pilot-consent-epoch"]!,
      nonce: values["pilot-nonce"]!, maxAmount: values["collection-cap-raw"]! };
  } else if (review.some(v => v !== undefined)) {
    if (values.role !== "reviewer" || review.some(v => v === undefined))
      throw new Error("Reviewer pilot requires a receipt and raw approval cap only");
    pilot = { role: "reviewer", receipt: values["pilot-receipt"]!, maxAmount: values["approval-cap-raw"]! };
  }
  if (pilot) validateRequest(pilot);
  return { role: values.role, mode: values.mode, submit: values.submit === true, pilot };
}

export function assertPilotIdentity(limit: PilotLimit, role: Role, inst: Instance) {
  if (limit.version !== 1 || limit.role !== role || limit.program !== inst.program || limit.config !== inst.config)
    throw new Error("Pilot limit belongs to a different role or endowment");
  validateRequest(limit);
}

const canonical = (limit: PilotLimit) => JSON.stringify({ version: limit.version, program: limit.program, config: limit.config,
  role: limit.role, maxAmount: limit.maxAmount, ...(limit.role === "collector"
    ? { owner: limit.owner, consentEpoch: limit.consentEpoch, nonce: limit.nonce } : { receipt: limit.receipt }) });

/** Call under worker.lock. A separate immutable control survives omitted flags,
 * restarts and expired transactions without changing payout journals/evidence.
 * Removing it requires explicit operator reconciliation; never automatic. */
export async function pilotLimit(input: {
  directory: string; role: Role; inst: Instance; request?: PilotRequest; submit: boolean; controls: LaunchControls;
}): Promise<PilotLimit | undefined> {
  const path = join(input.directory, PILOT_LIMIT_FILE);
  let existing: PilotLimit | undefined;
  try { existing = JSON.parse(await readFile(path, "utf8")) as PilotLimit; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (existing !== undefined) assertPilotIdentity(existing, input.role, input.inst);
  const requested = input.request ? { ...input.request, version: 1 as const,
    program: input.inst.program, config: input.inst.config } : undefined;
  if (requested) assertPilotIdentity(requested, input.role, input.inst);
  if (existing && requested && canonical(existing) !== canonical(requested))
    throw new Error("Pilot limit is already pinned; reconcile it before changing scope or amount");
  const limit = existing ?? requested;
  if (limit?.role === "collector" && (input.submit || requested)) {
    if (input.controls.mode !== "founders" || input.controls.founders.size !== 1 || !input.controls.founders.has(limit.owner))
      throw new Error("Capped collection requires founders mode and exactly the pilot owner in the allowlist");
  }
  if (limit && !existing && input.submit) {
    await mkdir(input.directory, { recursive: true, mode: 0o700 });
    const file = await open(path, "wx", 0o600);
    try { await file.writeFile(canonical(limit) + "\n"); await file.sync(); } finally { await file.close(); }
    const dir = await open(input.directory, "r");
    try { await dir.sync(); } finally { await dir.close(); }
  }
  return limit;
}

/** The on-chain nonce permits at most one successful debit in this scope. The
 * software cap reduces the amount before hashing/signing; it is not an SPL cap. */
export function cappedCollection(limit: PilotLimit | undefined, owner: string, snapshot: HoldSnapshot): HoldSnapshot {
  if (!limit) return snapshot;
  if (limit.role !== "collector") throw new Error("Wrong pilot role for collection");
  const matches = limit.owner === owner && limit.consentEpoch === snapshot.consentId && limit.nonce === snapshot.nonce;
  const cap = matches ? raw(limit.maxAmount) : 0n;
  return { ...snapshot, allowance: (raw(snapshot.allowance) < cap ? raw(snapshot.allowance) : cap).toString() };
}

/** Keep the independent decision intact. This selects a smaller approval only
 * for one receipt; other positive releases wait, while all refunds stay live. */
export function cappedSettlement(limit: PilotLimit | undefined, receiptKey: string, receipt: Receipt,
  action: "wait" | "refund" | "clear", verifiedAmount?: string) {
  if (!limit || action !== "clear") return { action, approvedAmount: verifiedAmount };
  if (limit.role !== "reviewer") throw new Error("Wrong pilot role for settlement");
  if (receiptKey !== limit.receipt) return { action: "wait" as const, approvedAmount: undefined };
  const cap = raw(limit.maxAmount), verified = raw(verifiedAmount);
  // Reviews cannot be revised on chain. Never release an earlier approval
  // above this cap: the remaining safe action is a full refund.
  if (cap === 0n || (receipt.reviewed && receipt.approved_amount > cap))
    return { action: "refund" as const, approvedAmount: "0" };
  return { action, approvedAmount: (verified < cap ? verified : cap).toString() };
}
