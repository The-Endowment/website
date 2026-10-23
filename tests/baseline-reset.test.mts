import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { address, createNoopSigner } from "@solana/kit";
import { baselineResetInstructions } from "../lib/holding/baseline-reset.ts";
import { decodeConfig, decodeLandlord, type Instance } from "../lib/endowment.ts";
import type { DelegationStatus } from "../lib/holding/delegation.ts";
import type { Holding } from "../lib/holding/wallet.ts";
import type { Consent } from "../lib/holding/types.ts";
import { common } from "../lib/holding/client.ts";
import { decodeAccount, schema } from "../lib/holding/codec.ts";
import fixture from "./fixtures/holding-chain.json" with { type: "json" };
import { loadTsxModule } from "./support/tsx-render.mts";

const inst: Instance = { program: address(fixture.program), config: address(fixture.config),
  coinMint: address(fixture.coinMint), dividendMint: address(fixture.dividendMint),
  coinTokenProgram: address(fixture.coinTokenProgram), dividendTokenProgram: address(fixture.dividendTokenProgram) };
const owner = createNoopSigner(address(fixture.owner));
const a = await common(inst, owner.address);
const records: Record<string, { data: string[] }> = fixture.records;
const bytes = (key: string) => Buffer.from(records[key].data[0], "base64");
const preview = { baseline: 100n, balance: 30n, consentEpoch: 1n };
function state() {
  const landlord = decodeLandlord(bytes(a.landlord))!;
  landlord.baseline = preview.baseline; landlord.reserved[0] = 0;
  const config = decodeConfig(bytes(inst.config))!;
  Object.assign(config, { retired: false, milestoneReached: false, pausedUntil: 0n });
  const consent = decodeAccount<Consent>("CollectionConsent", bytes(a.consent));
  Object.assign(consent, { enabled: true, epoch: preview.consentEpoch });
  const status: DelegationStatus = { config, landlord, dividendAccount: a.dividend_account, coinAccount: a.coin_account,
    dividendBalance: preview.balance, coinBalance: 100n, dividendDecimals: 6, expectedDelegate: a.authority,
    delegate: a.authority, delegatedToEndowment: true, delegationTooSmall: false, minStake: 0n, now: 1800000000 };
  const holding: Holding = { ready: true, consent, receipts: [] };
  return { status, holding };
}

test("fixed-floor reset uses only the existing owner-signed reset and legacy enable instructions", async () => {
  const { status, holding } = state();
  const ixs = await baselineResetInstructions(inst, owner, status, holding, preview);
  assert.equal(ixs.length, 2);
  for (const [index, name] of ["resync_baseline", "enable_collection"].entries()) {
    assert.equal(ixs[index].programAddress, inst.program);
    assert.deepEqual([...ixs[index].data!], schema.instructions[name].discriminator);
    assert.equal(ixs[index].accounts![0].address, owner.address);
    assert.ok(ixs[index].accounts![0].role >= 2, "Owner must sign");
  }
});

test("changed amounts, consent or protection mode require a new review", async () => {
  const changes = [
    ({ status }: ReturnType<typeof state>) => { status.dividendBalance = 31n; },
    ({ status }: ReturnType<typeof state>) => { status.landlord!.baseline = 90n; },
    ({ holding }: ReturnType<typeof state>) => { holding.consent!.epoch++; },
    ({ status }: ReturnType<typeof state>) => { status.landlord!.reserved[0] = 1; },
    ({ status }: ReturnType<typeof state>) => { status.dividendBalance = 100n; },
  ];
  for (const change of changes) {
    const value = state(); change(value);
    await assert.rejects(baselineResetInstructions(inst, owner, value.status, value.holding, preview));
  }
});

test("reset never re-enables stopped, revoked, foreign, closed or paused enrollment", async () => {
  const changes = [
    ({ status }: ReturnType<typeof state>) => { status.landlord = null; },
    ({ status }: ReturnType<typeof state>) => { status.delegatedToEndowment = false; },
    ({ holding }: ReturnType<typeof state>) => { holding.consent!.enabled = false; },
    ({ holding }: ReturnType<typeof state>) => { holding.ready = false; },
    ({ holding }: ReturnType<typeof state>) => { holding.consent!.owner = address(fixture.collector); },
    ({ status }: ReturnType<typeof state>) => { status.landlord!.owner = address(fixture.collector); },
    ({ status }: ReturnType<typeof state>) => { status.config.retired = true; },
    ({ status }: ReturnType<typeof state>) => { status.config.milestoneReached = true; },
    ({ status }: ReturnType<typeof state>) => { status.config.pausedUntil = BigInt(status.now + 1); },
  ];
  for (const change of changes) {
    const value = state(); change(value);
    await assert.rejects(baselineResetInstructions(inst, owner, value.status, value.holding, preview));
  }
});

type ResetProps = { baseline: bigint; balance: bigint; busy: boolean; canSign: boolean; onReset: () => void };
const { BaselineReset } = loadTsxModule<{ BaselineReset: ComponentType<ResetProps> }>("components/BaselineReset.tsx", {
  "@/lib/solana": { formatTokens: (value: bigint) => value.toString() },
});
test("reset explains cleared eligibility and refund-only receipts and requires unchecked consent", () => {
  const html = renderToStaticMarkup(createElement(BaselineReset, {
    baseline: 100n, balance: 30n, busy: false, canSign: true,
    onReset: () => assert.fail("Rendering must not request a signature"),
  }));
  assert.match(html, /100 PUMP/); assert.match(html, /30 PUMP/);
  assert.match(html, /uncollected eligibility is cleared/);
  assert.match(html, /pending contributions become refund-only/);
  assert.match(html, /when the transaction executes/);
  assert.doesNotMatch(html, /checked=""/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Review balance reset in wallet/);
});
