import { access, mkdir, open, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { address } from "@solana/kit";
import type { HoldSnapshot } from "./snapshot.ts";

export type LaunchMode = "founders" | "public";
export type LaunchControls = {
  mode?: LaunchMode;
  founders: Set<string>;
  stopFile: string;
};

/** Local operating controls supplement the contract; they cannot constrain a stolen key. */
export async function launchControls(input: {
  role: "collector" | "reviewer";
  submit: boolean;
  mode?: string;
  foundersFile?: string;
  stopFile: string;
}): Promise<LaunchControls> {
  if (input.mode && input.mode !== "founders" && input.mode !== "public")
    throw new Error("Collection mode must be founders or public");
  if (input.role === "collector" && input.submit && !input.mode)
    throw new Error("Collector submission requires --mode=founders or --mode=public");
  const founders = new Set<string>();
  if (input.role === "collector" && input.mode === "founders") {
    if (!input.foundersFile) throw new Error("Founders mode requires HOLD_FOUNDERS_FILE");
    const values: unknown = JSON.parse(await readFile(input.foundersFile, "utf8"));
    if (!Array.isArray(values) || values.length === 0)
      throw new Error("Founders file must contain a nonempty JSON array of public keys");
    for (const value of values) {
      if (typeof value !== "string") throw new Error("Invalid founder public key");
      founders.add(address(value));
    }
  }
  return { mode: input.mode as LaunchMode | undefined, founders, stopFile: input.stopFile };
}

export function includesOwner(controls: LaunchControls, role: string, owner: string) {
  return role !== "collector" || controls.mode !== "founders" || controls.founders.has(owner);
}

export async function collectionStopped(path: string) {
  try { await access(path); return true; }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new Error("Cannot read collection stop control");
  }
}

/** Never automatically clears. Only an operator may remove this file after investigation. */
export async function quarantine(path: string, code: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  let file;
  try { file = await open(path, "wx", 0o600); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return;
    throw e;
  }
  try {
    await file.writeFile(JSON.stringify({ stoppedAt: new Date().toISOString(), code }) + "\n");
    await file.sync();
  } finally { await file.close(); }
  const directory = await open(dirname(path), "r");
  try { await directory.sync(); } finally { await directory.close(); }
}

export async function assertCollectionAllowed(controls: LaunchControls, owner: string, snapshot: HoldSnapshot) {
  if (await collectionStopped(controls.stopFile)) throw new Error("Collection is quarantined; operator clearance required");
  if (!controls.mode) throw new Error("Collector submission requires an explicit launch mode");
  if (!snapshot.active) throw new Error("Collection is no longer active at signing or broadcast");
  if (!includesOwner(controls, "collector", owner)) throw new Error("Wallet is outside the founders allowlist");
  const p = snapshot.config.params;
  if (controls.mode === "public" && (!(snapshot.config.reserved[0] & 1) || p.activate_bps !== 3000 || p.deactivate_bps !== 2500))
    throw new Error("Public collection requires locked on-chain 30%/25% thresholds");
  if (p.allowance_margin_bps !== 10000 || p.max_rewards_per_day <= 0n || p.max_rewards_per_day > p.max_buy_per_day * 10n)
    throw new Error("Collection requires the on-chain 1.0x reward allowance");
}
