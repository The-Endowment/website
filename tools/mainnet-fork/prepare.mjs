import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { createNoopSigner, getAddressEncoder } from "@solana/kit";
import { instruction, schema } from "../../lib/holding/codec.ts";
import { decodeLandlord, refreshLandlordsIx, beginCountIx, countLandlordsIx, finishCountIx, registerLandlordIx } from "../../lib/endowment.ts";
import { common } from "../../lib/holding/client.ts";
import { json } from "./capture.mjs";
const require = createRequire(import.meta.url);
const sqds = require("@sqds/multisig");
const { PublicKey, TransactionMessage, TransactionInstruction, Keypair } = require("@solana/web3.js");
const pk = value => new PublicKey(value);
const discriminator = name => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const fromKit = ix => ({ program: ix.programAddress, accounts: ix.accounts.map(a => ({ address: a.address, signer: a.role >= 2, writable: a.role === 1 || a.role === 3 })), data: Buffer.from(ix.data).toString("base64") });
const fromWeb3 = ix => ({ program: ix.programId.toBase58(), accounts: ix.keys.map(a => ({ address: a.pubkey.toBase58(), signer: a.isSigner, writable: a.isWritable })), data: ix.data.toString("base64") });

/** SDK instruction builders only: no connection, signer key or RPC submission. */
export async function prepare(directory) {
  const snapshot = JSON.parse(await fs.readFile(new URL("snapshot.json", directory), "utf8"));
  const program = pk(snapshot.inst.program), config = pk(snapshot.inst.config);
  const multisig = pk("Gwvu6KdaM1YncnidJ8FTL6kta9F9Fb8yAAtnYAgcNiGN"), vault = pk(snapshot.config.admin);
  const roy = pk("13KDtmhNtJNuWNtse2y8tVpZqFbCb4mSnyodYNvPBeWJ"), brett = pk("FuqAQwjXwWeN5xAhDN8QCnCrfezmYwnAkQZqUoZEYhRJ");
  const raw = Buffer.from(snapshot.accounts[multisig.toBase58()].data[0], "base64");
  const [state] = sqds.accounts.Multisig.deserialize(raw);
  assert.equal(state.threshold, 2); assert.equal(state.timeLock, 0);
  assert.equal(state.configAuthority.toBase58(), "11111111111111111111111111111111");
  assert.deepEqual(state.members.map(m => m.key.toBase58()).sort(), [roy.toBase58(), brett.toBase58()].sort());
  const index = BigInt(state.transactionIndex.toString()) + 1n;
  const [transaction] = sqds.getTransactionPda({ multisigPda: multisig, index });
  const [proposal] = sqds.getProposalPda({ multisigPda: multisig, transactionIndex: index });
  const apply = new TransactionInstruction({ programId: program, keys: [{ pubkey: vault, isSigner: true, isWritable: false }, { pubkey: config, isSigner: false, isWritable: true }], data: discriminator("apply_params") });
  const message = new TransactionMessage({ payerKey: vault, recentBlockhash: "11111111111111111111111111111111", instructions: [apply] });
  const prepared = {
    create: sqds.instructions.vaultTransactionCreate({ multisigPda: multisig, transactionIndex: index, creator: roy, vaultIndex: 0, ephemeralSigners: 0, transactionMessage: message }),
    proposalCreate: sqds.instructions.proposalCreate({ multisigPda: multisig, creator: roy, transactionIndex: index, isDraft: false }),
    approveRoy: sqds.instructions.proposalApprove({ multisigPda: multisig, transactionIndex: index, member: roy }),
    approveBrett: sqds.instructions.proposalApprove({ multisigPda: multisig, transactionIndex: index, member: brett }),
  };
  const remaining = [{ pubkey: vault, isSigner: false, isWritable: true }, { pubkey: config, isSigner: false, isWritable: true }, { pubkey: program, isSigner: false, isWritable: false }];
  prepared.executeRoy = sqds.generated.createVaultTransactionExecuteInstruction({ multisig, proposal, transaction, member: roy, anchorRemainingAccounts: remaining });
  for (const [name, member] of [["cancelRoy", roy], ["cancelBrett", brett]]) {
    prepared[name] = sqds.generated.createVaultTransactionExecuteInstruction({ multisig, proposal: pk("DW1gQTnD9F2aPcEWmsMMQ3pcLFntUtHPgEuB3E1aFAB3"), transaction: pk("3zn8h68d68DU3GL7UyWg5EvGPNXmpJUMrHTkuLST69mv"), member, anchorRemainingAccounts: remaining });
  }
  prepared.directApplyAdmin = apply;
  prepared.directApplyOutsider = new TransactionInstruction({ programId: program, keys: [{ pubkey: pk(snapshot.owners[0]), isSigner: true, isWritable: false }, { pubkey: config, isSigner: false, isWritable: true }], data: discriminator("apply_params") });
  const instructions = Object.fromEntries(Object.entries(prepared).map(([name, ix]) => [name, fromWeb3(ix)]));
  const params = Object.fromEntries(schema.types.Params.fields.map(field => [field.name, ["u64", "i64"].includes(field.type) ? BigInt(snapshot.config.params[field.name]) : snapshot.config.params[field.name]]));
  instructions.proposeFounderAgain = fromKit(instruction(snapshot.inst.program, "propose_params", { admin: createNoopSigner(snapshot.config.admin), config: snapshot.inst.config }, { params }));
  const rows = snapshot.walletAccounts.map(a => ({ address: a.landlord, record: decodeLandlord(Buffer.from(snapshot.accounts[a.landlord].data[0], "base64")) }));
  instructions.refresh = fromKit(await refreshLandlordsIx(snapshot.inst, createNoopSigner(snapshot.config.params.refresher), rows));
  instructions.beginCount = fromKit(beginCountIx(snapshot.inst));
  instructions.count = fromKit(await countLandlordsIx(snapshot.inst, rows));
  instructions.finishCount = fromKit(finishCountIx(snapshot.inst));
  // An ephemeral public identity and three local-only account fixtures exercise
  // registration below the minimum. No private key is stored or used to sign.
  const localOwner = Keypair.generate().publicKey.toBase58();
  const a = await common(snapshot.inst, localOwner);
  instructions.registerSmall = fromKit(await registerLandlordIx(snapshot.inst, createNoopSigner(localOwner), a.dividend_account, a.coin_account));
  const localRegistrationFixtures = { purpose: "Three local-only accounts for a new holder with 1 PENIS; the source mainnet snapshot is unchanged.", accounts: {} };
  for (const [dest, source, amount] of [[a.coin_account, snapshot.walletAccounts[0].coin_account, 1_000_000n], [a.dividend_account, snapshot.walletAccounts[0].dividend_account, null]]) {
    const clone = structuredClone(snapshot.accounts[source]);
    const data = Buffer.from(clone.data[0], "base64"); Buffer.from(getAddressEncoder().encode(localOwner)).copy(data, 32);
    if (amount !== null) data.writeBigUInt64LE(amount, 64);
    clone.data = [data.toString("base64"), "base64"]; localRegistrationFixtures.accounts[dest] = clone;
  }
  localRegistrationFixtures.accounts[localOwner] = { lamports: 1_000_000_000, data: ["", "base64"], owner: "11111111111111111111111111111111", executable: false, rentEpoch: 0 };
  await fs.writeFile(new URL("instructions.json", directory), json({ transactionIndex: String(index), transactionAddress: transaction.toBase58(), proposalAddress: proposal.toBase58(), payer: roy.toBase58(), admin: vault.toBase58(), outsider: snapshot.owners[0], instructions, localRegistrationFixtures }) + "\n");
}
