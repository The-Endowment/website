// Launch steps for the $PENIS endowment. Every command simulates by default and
// sends only with --send. Admin steps either sign with a local key
// (--admin-key, for a fork rehearsal) or print the instruction for the Squads
// admin to propose (--admin <vault address>), since the admin is a multisig.
//
//   node scripts/launch.mts addresses
//   node scripts/launch.mts create  --params launch/params.json --creator-key <file> [--send]
//   node scripts/launch.mts init-collection --collector <addr> --reviewer <addr> (--admin-key <file> | --admin <vault>) [--send]
//   node scripts/launch.mts propose-params  --params launch/public.json (--admin-key <file> | --admin <vault>) [--send]
//   node scripts/launch.mts apply-params    --payer-key <file> [--send]
//
// Environment: SOLANA_RPC_URL (a paid endpoint for mainnet; a local fork URL for rehearsals).
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
import { instruction, schema } from "../lib/holding/codec.ts";
import type { CreateParams, Params } from "../lib/holding/accounts.ts";
import { keySigner } from "../lib/holding/sign.ts";
import { checkLaunchParams, parseParams } from "../lib/launch-params.ts";

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
const rpcUrl = process.env.SOLANA_RPC_URL;
if (!rpcUrl && command !== "addresses") throw new Error("Set SOLANA_RPC_URL");

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
  if (key && !vault) return { signer: await keySigner(key), local: true };
  if (vault && !key) return { signer: createNoopSigner(address(vault)), local: false };
  throw new Error("Pass exactly one of --admin-key <file> or --admin <vault address>");
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
  console.log("Instructions for the Squads vault to execute:");
  console.log(json(ixs.map((ix) => ({
    programId: ix.programAddress,
    accounts: ix.accounts?.map((a) => ({ pubkey: a.address, role: a.role })),
    data: getBase58Decoder().decode(ix.data!),
  }))));
  console.log("\nBase58 transaction message (import into the Squads transaction builder):");
  console.log(getBase58Decoder().decode(compiled.messageBytes));
  console.log("\nThe vault pays rent for any new accounts, so fund it first. Nothing was sent.");
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
} else if (command === "create") {
  const creator = await keySigner(flag("creator-key"));
  if (creator.address !== PROGRAM_FLAGSHIP_CREATOR) throw new Error(`The creator key must be ${PROGRAM_FLAGSHIP_CREATOR}`);
  const file = JSON.parse(await readFile(flag("params") ?? "", "utf8"));
  const params = parseParams(file.params ?? file);
  const create: CreateParams = {
    admin: address(file.admin), guardian: address(file.guardian), params, contribution_cap: GOAL,
  };
  checkLaunchParams(params, { creating: true });
  if (create.admin === PROGRAM_FLAGSHIP_CREATOR || create.guardian === PROGRAM_FLAGSHIP_CREATOR) {
    console.log("Warning: admin or guardian is the creator key itself, not a multisig. Fine for a rehearsal only.");
  }
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
  const collector = address(flag("collector") ?? ""), reviewer = address(flag("reviewer") ?? "");
  if (collector === reviewer) throw new Error("The collector and reviewer must be different keys");
  const { signer: admin, local } = await adminSigner();
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
  const ix = instruction(PROGRAM, "propose_params", { admin, config: inst.config }, { params });
  if (local) await run(admin, [ix]);
  else await printForSquads(admin.address, [ix]);
} else if (command === "apply-params") {
  // Anyone may apply after the grace period; before it, only the admin.
  const caller = await keySigner(flag("payer-key"));
  await run(caller, [instruction(PROGRAM, "apply_params", { caller, config: inst.config })]);
} else {
  console.log("Commands: addresses | create | init-collection | propose-params | apply-params (see the top of this file)");
  process.exit(1);
}
