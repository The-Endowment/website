import assert from "node:assert/strict";
import { test } from "node:test";
import { AccountRole, address, createNoopSigner, none, some, type Address } from "@solana/kit";
import { getTokenDecoder, getTokenEncoder, parseRevokeInstruction, TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import fixture from "./fixtures/holding-chain.json" with { type: "json" };
import { ata, authorityPda, type Instance } from "../lib/endowment.ts";
import { revokeEndowmentApprovalIx } from "../lib/holding/delegation.ts";
import { consentIx, holdPda } from "../lib/holding/client.ts";
import { schema } from "../lib/holding/codec.ts";

const inst: Instance = {
  program: address(fixture.program), config: address(fixture.config),
  coinMint: address(fixture.coinMint), dividendMint: address(fixture.dividendMint),
  coinTokenProgram: address(fixture.coinTokenProgram), dividendTokenProgram: address(fixture.dividendTokenProgram),
};
const owner = address(fixture.owner), signer = createNoopSigner(owner);
const source = await ata(owner, inst.dividendMint, inst.dividendTokenProgram);
const authority = await authorityPda(inst.program, inst.config);
const account = (fixture.records as Record<string, { owner: string; data: string[] }>)[source];
const token = getTokenDecoder().decode(Buffer.from(account.data[0], "base64"));
type RecoveryRpc = Parameters<typeof revokeEndowmentApprovalIx>[0];

function tokenAccount(fields: Partial<typeof token> = {}) {
  return {
    ...account,
    data: [Buffer.from(getTokenEncoder().encode({ ...token, ...fields })).toString("base64"), "base64"],
  };
}

/** Only this canonical token-account read works; all dashboard reads fail. */
function recoveryRpc(response: unknown, failure?: Error) {
  const reads: Address[] = [];
  const rpc = new Proxy({
    getAccountInfo: (key: Address, options: { encoding: string }) => ({ send: async () => {
      reads.push(key);
      assert.equal(key, source, "Recovery must not depend on config, mints, enrollment or receipts");
      assert.equal(options.encoding, "base64");
      if (failure) throw failure;
      return response;
    } }),
  }, {
    get(target, property) {
      if (property !== "getAccountInfo") throw new Error("Dashboard RPC unavailable");
      return target.getAccountInfo;
    },
  }) as unknown as RecoveryRpc;
  return { rpc, reads };
}

test("independent approval recovery reads only the PUMP account and builds an owner-signed Token-2022 revoke", async () => {
  assert.deepEqual(token.delegate, some(authority));
  const { rpc, reads } = recoveryRpc({ value: account });
  const ix = await revokeEndowmentApprovalIx(rpc, inst, signer);
  assert.deepEqual(reads, [source]);
  assert.equal(ix.programAddress, TOKEN_2022_PROGRAM_ADDRESS);
  assert.deepEqual([...ix.data], [5]); // SPL Token Revoke, not a transfer or approval.
  assert.equal(ix.accounts.length, 2);
  const parsed = parseRevokeInstruction(ix);
  assert.equal(parsed.data.discriminator, 5);
  assert.equal(parsed.accounts.source.address, source);
  assert.equal(parsed.accounts.source.role, AccountRole.WRITABLE);
  assert.equal(parsed.accounts.owner.address, owner);
  assert.equal(parsed.accounts.owner.role, AccountRole.READONLY_SIGNER);
  assert.equal(ix.accounts[1].signer, signer);
});

test("recovery never builds a revoke for another application's approval or a missing approval", async () => {
  for (const delegate of [some(address(fixture.reviewer)), none<Address>()]) {
    const { rpc, reads } = recoveryRpc({ value: tokenAccount({ delegate }) });
    await assert.rejects(revokeEndowmentApprovalIx(rpc, inst, signer), /no approval for this endowment/);
    assert.deepEqual(reads, [source]);
  }
  await assert.rejects(revokeEndowmentApprovalIx(recoveryRpc({ value: null }).rpc, inst, signer), /no PUMP token account/);
});

test("recovery rejects mismatched token owner, mint and program before proposing any instruction", async () => {
  for (const value of [
    tokenAccount({ owner: address(fixture.reviewer) }),
    tokenAccount({ mint: inst.coinMint }),
    { ...account, owner: inst.program },
  ]) {
    const { rpc, reads } = recoveryRpc({ value });
    await assert.rejects(revokeEndowmentApprovalIx(rpc, inst, signer), /Could not verify this wallet's PUMP account/);
    assert.deepEqual(reads, [source]);
  }
});

test("failed or malformed token-account reads cannot produce a recovery instruction", async () => {
  for (const response of [
    undefined,
    null,
    {},
    { value: {} },
    { value: { ...account, data: null } },
    { value: { ...account, data: [Buffer.from([1, 2, 3]).toString("base64"), "base64"] } },
  ]) await assert.rejects(revokeEndowmentApprovalIx(recoveryRpc(response).rpc, inst, signer));
  await assert.rejects(
    revokeEndowmentApprovalIx(recoveryRpc(undefined, new Error("Token RPC unavailable")).rpc, inst, signer),
    /Token RPC unavailable/,
  );
});

test("disabling consent requires only the owner and consent address, without any RPC", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("All network reads unavailable"); });
  const ix = await consentIx(inst, signer, "disable_collection");
  assert.equal(ix.programAddress, inst.program);
  assert.deepEqual([...ix.data!], schema.instructions.disable_collection.discriminator);
  assert.deepEqual(ix.accounts?.map(({ address, role }) => ({ address, role })), [
    { address: owner, role: AccountRole.READONLY_SIGNER },
    { address: await holdPda(inst, "consent", owner), role: AccountRole.WRITABLE },
  ]);
  const ownerAccount = ix.accounts?.[0];
  assert.ok(ownerAccount && "signer" in ownerAccount);
  assert.equal(ownerAccount.signer, signer);
});
