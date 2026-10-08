// Launch steps for the $PENIS endowment. Local signers simulate, and send only
// with --send. --admin <vault> only prepares instructions for Squads: it neither
// simulates nor sends. --admin-key requires --rehearsal and a local fork URL.
//
//   node scripts/launch.mts addresses
//   node scripts/launch.mts status
//   node scripts/launch.mts create  --params launch/params.json --creator-key <file> [--send]
//   node scripts/launch.mts init-collection --collector <addr> --reviewer <addr> (--admin-key <file> | --admin <vault>) [--send]
//   node scripts/launch.mts propose-params  --params launch/public.json (--admin-key <file> | --admin <vault>) [--send]
//   node scripts/launch.mts apply-params    --admin <vault>
//   node scripts/launch.mts apply-params    --payer-key <file> [--send] # after the additional 24h grace period
//
// Environment: SOLANA_RPC_URL (a suitable mainnet endpoint, or a local fork URL).
import { readFile } from "node:fs/promises";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import {
  ata,
  authorityPda,
  configPda,
  PENIS_MINT,
  PROGRAM_FLAGSHIP_CREATOR,
  PUMP_MINT,
  SYSTEM_PROGRAM,
  type Instance,
} from "../lib/endowment.ts";
import { holdPda } from "../lib/holding/client.ts";
import { decodeAccount, instruction, schema } from "../lib/holding/codec.ts";
import type { CollectionPolicy, Config, CreateParams, Params } from "../lib/holding/accounts.ts";
import { keySigner } from "../lib/holding/sign.ts";
import { checkLaunchParams, checkLaunchRoles, checkRehearsal, explicitRole, parseParams } from "../lib/launch-params.ts";

const PROGRAM = address(schema.address);
const POOL = address("AXTq4JHNYHSnooqjoDmtL9WW5eEgnkkMSWq76Kznidnz");
const GOAL = 200_000_000n * 1_000_000n;

const args = process.argv.slice(2);
const command = args[0];
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i > 0 ? args[i + 1] : undefined;
};
const send = args.includes("--send");
const rehearsal = args.includes("--rehearsal");
const rpcUrl = process.env.SOLANA_RPC_URL;
if (!rpcUrl && command !== "addresses") throw new Error("Set SOLANA_RPC_URL");
checkRehearsal(rehearsal, rpcUrl);

async function instance(): Promise<Instance> {
  return {
    program: PROGRAM,
    config: await configPda(PROGRAM, PENIS_MINT, PROGRAM_FLAGSHIP_CREATOR),
    coinMint: PENIS_MINT,
    dividendMint: PUMP_MINT,
    coinTokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    dividendTokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  };
}

/** A local key signs; a vault address gets a placeholder signer and the instruction is printed for Squads. */
async function adminSigner(): Promise<{ signer: TransactionSigner; local: boolean }> {
  const key = flag("admin-key"), vault = flag("admin");
  if (key && !vault) {
    if (!rehearsal) throw new Error("--admin-key requires --rehearsal; production admin steps use --admin <Squads vault>");
    return { signer: await keySigner(key), local: true };
  }
  if (vault && !key) {
    if (send) throw new Error("--admin prepares instructions only; execute through Squads, without --send");
    return { signer: createNoopSigner(explicitRole(vault, "admin")), local: false };
  }
  throw new Error("Pass exactly one of --admin-key <file> or --admin <vault address>");
}

async function readAccount<T>(name: string, account: Address): Promise<T | null> {
  const { value } = await createSolanaRpc(rpcUrl!).getAccountInfo(account, {
    encoding: "base64", commitment: "confirmed",
  }).send();
  if (!value) return null;
  if (value.owner !== PROGRAM) throw new Error(`${name} has the wrong program owner`);
  return decodeAccount<T>(name, Buffer.from(value.data[0], "base64"));
}

async function launchConfig(inst: Instance, admin?: Address) {
  const config = await readAccount<Config>("Config", inst.config);
  if (!config || config.version !== 4) throw new Error("No supported endowment config; create and verify it first");
  if (admin && admin !== config.admin) throw new Error("The supplied admin does not match the on-chain admin vault");
  return config;
}

async function checkConfiguredRoles(inst: Instance, config: Config, refresher = config.params.refresher) {
  const policy = await readAccount<CollectionPolicy>("CollectionPolicy", await holdPda(inst, "policy"));
  checkLaunchRoles({ admin: config.admin, guardian: config.guardian, refresher,
    ...(policy ? { collector: policy.collector, reviewer: policy.reviewer } : {}),
  }, PROGRAM_FLAGSHIP_CREATOR, rehearsal);
  return policy;
}

const json = (value: unknown) =>
  JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);

/** For Squads: the instruction itself, and a base58 transaction message with the vault paying. */
async function printForSquads(vault: Address, ixs: Instruction[]) {
  const rpc = createSolanaRpc(rpcUrl!);
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "finalized" }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(vault, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
  const compiled = compileTransaction(message);
  console.log("Prepared only: not simulated, submitted, or approved. Review and simulate through Squads before execution.");
  console.log("Instructions for the Squads vault to execute:");
  console.log(json(ixs.map((ix) => ({
    programId: ix.programAddress,
    accounts: ix.accounts?.map((a) => ({ pubkey: a.address, role: a.role })),
    data: getBase58Decoder().decode(ix.data!),
  }))));
  console.log("\nBase58 transaction message (import into the Squads transaction builder):");
  console.log(getBase58Decoder().decode(compiled.messageBytes));
  console.log("\nThe vault pays rent for any new accounts. Rebuild the message if its blockhash expires. Nothing was sent.");
}

/** Simulate, and with --send submit and confirm. */
async function run(payer: TransactionSigner, ixs: Instruction[]) {
  const rpc = createSolanaRpc(rpcUrl!);
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "finalized" }).send();
  const signed = await signTransactionMessageWithSigners(pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  ));
  const wire = getBase64EncodedWireTransaction(signed);
  const sim = await rpc.simulateTransaction(wire, { encoding: "base64", commitment: "confirmed" }).send();
  for (const line of sim.value.logs ?? []) console.log(`  ${line}`);
  if (sim.value.err) throw new Error(`Simulation failed: ${json(sim.value.err)}`);
  console.log("Simulation passed.");
  if (!send) return console.log("Not sent (add --send).");
  const signature = await rpc.sendTransaction(wire, { encoding: "base64" }).send();
  console.log(`Sent ${signature}; waiting for confirmation...`);
  for (let i = 0; i < 60; i++) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err) throw new Error(`Failed on-chain: ${json(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return console.log(`Confirmed: ${getSignatureFromTransaction(signed)}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Not confirmed after two minutes; check ${signature} before retrying`);
}

async function loadParams(): Promise<Params> {
  const file = flag("params");
  if (!file) throw new Error("--params <file> is required");
  return parseParams(JSON.parse(await readFile(file, "utf8")));
}

const inst = await instance();

if (command === "addresses") {
  const authority = await authorityPda(PROGRAM, inst.config);
  const policy = await holdPda(inst, "policy");
  console.log(json({
    program: PROGRAM, creator: PROGRAM_FLAGSHIP_CREATOR, config: inst.config, authority,
    dividendVault: await ata(authority, PUMP_MINT), coinVault: await ata(authority, PENIS_MINT),
    collectionPolicy: policy, pendingVault: await ata(policy, PUMP_MINT), pool: POOL,
  }));
} else if (command === "status") {
  const config = await launchConfig(inst);
  const policy = await readAccount<CollectionPolicy>("CollectionPolicy", await holdPda(inst, "policy"));
  console.log(json({ config: inst.config, version: config.version,
    admin: config.admin, guardian: config.guardian, refresher: config.params.refresher,
    collector: policy?.collector ?? null, reviewer: policy?.reviewer ?? null,
    publicLocked: config.reserved[0] !== 0, active: config.active,
    pausedUntil: config.paused_until, retired: config.retired,
    lastCountAt: config.last_count_at, lastCountBps: config.last_count_bps,
    rewardIndex: config.reward_index, rewardCreditOk: config.reward_credit_ok,
    pendingEffectiveAt: config.pending.effective_at,
    pendingParams: config.pending.effective_at !== 0n ? config.pending.params : null, params: config.params,
  }));
  console.log("Read-only snapshot; verify Squads membership, thresholds, config authority and upgrade authority separately.");
} else if (command === "create") {
  const creator = await keySigner(flag("creator-key"));
  if (creator.address !== PROGRAM_FLAGSHIP_CREATOR) throw new Error(`The creator key must be ${PROGRAM_FLAGSHIP_CREATOR}`);
  const file = JSON.parse(await readFile(flag("params") ?? "", "utf8"));
  const params = parseParams(file.params ?? file);
  const create: CreateParams = {
    admin: explicitRole(file.admin, "admin"), guardian: explicitRole(file.guardian, "guardian"), params, contribution_cap: GOAL,
  };
  checkLaunchParams(params, { creating: true });
  checkLaunchRoles({ admin: create.admin, guardian: create.guardian, refresher: params.refresher },
    PROGRAM_FLAGSHIP_CREATOR, rehearsal);
  const authority = await authorityPda(PROGRAM, inst.config);
  console.log(json({ config: inst.config, ...create }));
  await run(creator, [instruction(PROGRAM, "create_endowment", {
    creator, config: inst.config, authority, coin_mint: PENIS_MINT, dividend_mint: PUMP_MINT,
    dividend_vault: await ata(authority, PUMP_MINT), coin_vault: await ata(authority, PENIS_MINT),
    pool_state: POOL, coin_token_program: TOKEN_2022_PROGRAM_ADDRESS,
    dividend_token_program: TOKEN_2022_PROGRAM_ADDRESS,
    associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, system_program: SYSTEM_PROGRAM,
  }, { params: create })]);
} else if (command === "init-collection") {
  const collector = explicitRole(flag("collector"), "collector"), reviewer = explicitRole(flag("reviewer"), "reviewer");
  const { signer: admin, local } = await adminSigner();
  const config = await launchConfig(inst, admin.address);
  checkLaunchRoles({ admin: config.admin, guardian: config.guardian, refresher: config.params.refresher,
    collector, reviewer }, PROGRAM_FLAGSHIP_CREATOR, rehearsal);
  const policy = await holdPda(inst, "policy");
  const ix = instruction(PROGRAM, "initialize_collection", {
    admin, config: inst.config, policy, dividend_mint: PUMP_MINT, pending_vault: await ata(policy, PUMP_MINT),
    dividend_token_program: TOKEN_2022_PROGRAM_ADDRESS,
    associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, system_program: SYSTEM_PROGRAM,
  }, { collector, reviewer });
  if (local) await run(admin, [ix]);
  else await printForSquads(admin.address, [ix]);
} else if (command === "propose-params") {
  const params = await loadParams();
  checkLaunchParams(params, { creating: false });
  if (params.activate_bps === 3000) {
    console.log("This proposal moves to public mode. Once applied it is irreversible: 30%/25% for good.");
  }
  const { signer: admin, local } = await adminSigner();
  const config = await launchConfig(inst, admin.address);
  await checkConfiguredRoles(inst, config, params.refresher);
  const ix = instruction(PROGRAM, "propose_params", { admin, config: inst.config }, { params });
  if (local) await run(admin, [ix]);
  else await printForSquads(admin.address, [ix]);
} else if (command === "apply-params") {
  // The Squads admin may apply at 72h. Other callers must wait another 24h.
  if (flag("payer-key") && (flag("admin") || flag("admin-key"))) {
    throw new Error("Use either --payer-key or an admin option, not both");
  }
  const { signer: caller, local } = flag("payer-key")
    ? { signer: await keySigner(flag("payer-key")), local: true }
    : await adminSigner();
  const config = await launchConfig(inst, flag("payer-key") ? undefined : caller.address);
  if (config.pending.effective_at === 0n) throw new Error("No pending parameter proposal");
  checkLaunchParams(config.pending.params, { creating: false });
  await checkConfiguredRoles(inst, config, config.pending.params.refresher);
  const ix = instruction(PROGRAM, "apply_params", { caller, config: inst.config });
  if (local) await run(caller, [ix]);
  else await printForSquads(caller.address, [ix]);
} else {
  console.log("Commands: addresses | status | create | init-collection | propose-params | apply-params (see the top of this file)");
  process.exit(1);
}
