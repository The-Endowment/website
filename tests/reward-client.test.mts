import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { address, createNoopSigner, type Instruction } from "@solana/kit";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { collectRewardIx, encodeReport, enrollRewardsIx, renewRewardConsentIx } from "../lib/reward-client.ts";
import { PUMP_MINT, PENIS_MINT, type Instance } from "../lib/endowment.ts";
import { REWARD_DISC } from "../lib/reporter/discriminators.ts";

type IdlAccount = { name: string; writable?: boolean; signer?: boolean; accounts?: IdlAccount[] };
type Idl = { instructions: { name: string; discriminator: number[]; accounts: IdlAccount[] }[]; types: { name: string; type: { fields: { name: string }[] } }[] };
const idl = JSON.parse(await readFile(new URL("./fixtures/reporter-idl.json", import.meta.url), "utf8")) as Idl;
const key = address("HpsRzXK3xWQxD1Px1KoExP5KYWs5gByEu47z6Ne6gDNf");
const inst: Instance = { program: address("5VBiPX39xFTgwRaUbC3F3HCuVcM3VkTuYDkxwrhYby2u"), config: key, coinMint: PENIS_MINT, dividendMint: PUMP_MINT, coinTokenProgram: TOKEN_2022_PROGRAM_ADDRESS, dividendTokenProgram: TOKEN_2022_PROGRAM_ADDRESS };
const signer = createNoopSigner(key);
const flatten = (accounts: IdlAccount[]): IdlAccount[] => accounts.flatMap((a) => a.accounts ? flatten(a.accounts) : [a]);
function check(name: string, ix: Instruction) {
  const expected = idl.instructions.find((x) => x.name === name)!;
  assert.deepEqual([...ix.data!.slice(0, 8)], expected.discriminator);
  assert.deepEqual(ix.accounts?.map((x) => x.role), flatten(expected.accounts).map((x) => (x.writable ? 1 : 0) + (x.signer ? 2 : 0)));
}

test("client instruction discriminator and account privileges match generated Anchor IDL", async () => {
  check("enroll_rewards", await enrollRewardsIx(inst, signer));
  check("renew_reward_consent", await renewRewardConsentIx(inst, signer));
  const ix = await collectRewardIx(inst, key, key, { ammConfig: key, vaults: [PUMP_MINT, PENIS_MINT], mints: [PUMP_MINT, PENIS_MINT], lpMint: key, observation: key }, signer,
    { consentId: 1n, nonce: 2n, collectionEpoch: 3n, reporterEpoch: 4n, amount: 5n, expectedSourceBalance: 6n, issuedAt: 7n, expiresAt: 8n, evidenceHash: new Uint8Array(32).fill(9) });
  check("collect_reward", ix);
  assert.equal(ix.data?.length, 104);
  for (const entry of idl.instructions) assert.deepEqual(REWARD_DISC[entry.name as keyof typeof REWARD_DISC], entry.discriminator);
});

test("report serialization matches IDL field order and preserves values above JS safe integers", () => {
  const fields = idl.types.find((x) => x.name === "RewardReport")!.type.fields;
  assert.deepEqual(fields.map((x) => x.name), ["consent_id", "nonce", "collection_epoch", "reporter_epoch", "amount", "expected_source_balance", "issued_at", "expires_at", "evidence_hash"]);
  const encoded = encodeReport({ consentId: 1n, nonce: 2n, collectionEpoch: 3n, reporterEpoch: 4n, amount: 9_007_199_254_740_993n, expectedSourceBalance: 10_000_000_000_000_000n, issuedAt: -1n, expiresAt: 9n, evidenceHash: new Uint8Array(32).fill(0xaa) });
  const view = new DataView(encoded.buffer);
  assert.equal(view.getBigUint64(32, true), 9_007_199_254_740_993n);
  assert.equal(view.getBigInt64(48, true), -1n);
  assert.deepEqual([...encoded.slice(64)], Array(32).fill(0xaa));
});
