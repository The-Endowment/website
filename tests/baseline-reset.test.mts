import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { createElement, type ComponentType, type ReactNode } from "react";
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
import * as endowment from "../lib/endowment.ts";

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

type ResetProps = { baseline: bigint; balance: bigint; busy: boolean; resetting?: boolean; canSign: boolean; onReset: () => void };
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
  assert.match(html, /temporarily stops counting/);
  assert.match(html, /SOL network fee/);
  assert.doesNotMatch(html, /checked=""/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Review balance reset in wallet/);
});

function closedPanel(initial: ReturnType<typeof state>, fresh = initial, canSign = true,
  options: { lastTransaction?: { signature: string; action: "reset" | "update" }; resetRunning?: boolean; enrollmentOpen?: boolean } = {}) {
  // Seed the loaded dashboard, keeping real React rendering and the real action
  // callbacks. Only wallet transport and RPC reads are replaced; nothing signs.
  const loaded: unknown[] = [null, null, initial.status, initial.holding, null, null, false, 0, options.lastTransaction ?? null, null];
  const actions: ((signal: AbortSignal) => Promise<unknown>)[] = [];
  const requests: unknown[] = [];
  const { ConfiguredDelegatePanel } = loadTsxModule<{ ConfiguredDelegatePanel: ComponentType<{ inst: Instance }> }>(
    "components/DelegatePanel.tsx", {
      react: { ...React, useState: (value: unknown) => React.useState(loaded.length ? loaded.shift() : value) },
      "@solana/kit-plugin-wallet/react": {
        useConnectedWallet: () => ({ account: { address: owner.address }, signer: canSign ? owner : null,
          supportedTransactionVersions: new Set(canSign ? [0] : []) }),
        useWallets: () => [], useConnect: () => ({ isRunning: false }),
        useDisconnect: () => ({ dispatch: () => {} }),
        WalletReadyGate: ({ children }: { children: ReactNode }) => createElement(React.Fragment, null, children),
      },
      "@solana/react": { useAction: (action: (signal: AbortSignal) => Promise<unknown>) => {
        actions.push(action); return { isRunning: actions.length === 2 && Boolean(options.resetRunning), dispatch: action };
      } },
      "@/components/WalletClient": { client: { identity: owner, rpc: {}, sendTransaction: async (ixs: unknown) => {
        requests.push(ixs); return { context: { signature: "test-only-no-broadcast" } };
      } } },
      "@/lib/endowment": endowment,
      "@/lib/holding/delegation": { loadDelegationStatus: async () => fresh.status },
      "@/lib/holding/wallet": { loadHolding: async () => fresh.holding },
      "@/lib/solana": { formatTokens: (value: bigint) => value.toString() },
      "@/lib/site": { DELEGATION_OPEN: Boolean(options.enrollmentOpen), links: {} },
    },
  );
  const html = renderToStaticMarkup(createElement(ConfiguredDelegatePanel, { inst }));
  return { html, requests, enroll: () => actions[0](new AbortController().signal),
    reset: () => actions[1](new AbortController().signal) };
}

test("closed public enrollment still exposes an existing holder's reset and prepares only the reviewed instructions", async () => {
  const value = state();
  const panel = closedPanel(value);
  assert.match(panel.html, /Reset your protected PUMP balance/);
  assert.match(panel.html, /<button[^>]*disabled=""[^>]*>Review balance reset in wallet/);
  assert.doesNotMatch(panel.html, /checked=""/);
  assert.doesNotMatch(panel.html, /You(?:’|&rsquo;|&#x27;)re a landlord/);
  assert.doesNotMatch(panel.html, /aria-label="Pledge setup"/);
  assert.ok(panel.html.indexOf("Reset your protected PUMP balance") < panel.html.indexOf("<dt>Wallet</dt>"), "Reset is the primary task before the balance dashboard");
  await panel.reset();
  assert.deepEqual(panel.requests, [await baselineResetInstructions(inst, owner, value.status, value.holding, preview)]);
  await assert.rejects(panel.enroll(), /Joining is unavailable/);
  assert.equal(panel.requests.length, 1);
});

test("closed enrollment resets cannot enroll, re-enable stopped consent, bypass chain checks or skip fresh review", async () => {
  const invalid = [
    (value: ReturnType<typeof state>) => { value.status.landlord = null; },
    (value: ReturnType<typeof state>) => { value.holding.consent!.enabled = false; },
    (value: ReturnType<typeof state>) => { value.status.delegatedToEndowment = false; },
    (value: ReturnType<typeof state>) => { value.status.landlord!.reserved[0] = 1; },
    (value: ReturnType<typeof state>) => { value.status.config.pausedUntil = BigInt(value.status.now + 1); },
    (value: ReturnType<typeof state>) => { value.status.config.retired = true; },
    (value: ReturnType<typeof state>) => { value.status.config.milestoneReached = true; },
    (value: ReturnType<typeof state>) => { value.holding.ready = false; },
    (value: ReturnType<typeof state>) => { value.status.minStake = value.status.coinBalance + 1n; },
  ];
  for (const change of invalid) {
    const value = state(); change(value);
    const panel = closedPanel(value);
    assert.doesNotMatch(panel.html, /Reset your protected PUMP balance/);
    await assert.rejects(panel.reset());
    await assert.rejects(panel.enroll());
    assert.equal(panel.requests.length, 0);
    const raced = closedPanel(state(), value);
    await assert.rejects(raced.reset());
    assert.equal(raced.requests.length, 0);
  }
  const changed = state(); changed.status.dividendBalance++;
  const raced = closedPanel(state(), changed);
  await assert.rejects(raced.reset(), /changed/);
  assert.equal(raced.requests.length, 0);
  const readOnly = closedPanel(state(), undefined, false);
  await assert.rejects(readOnly.reset(), /cannot sign/);
  assert.equal(readOnly.requests.length, 0);
});

test("reset progress prevents duplicate clicks and explains that the page will refresh after confirmation", () => {
  const value = state();
  const panel = closedPanel(value, value, true, { resetRunning: true });
  assert.match(panel.html, /aria-busy="true"/);
  assert.match(panel.html, /<button[^>]*disabled=""[^>]*>Confirming balance reset/);
  assert.match(panel.html, /refresh your pledge when the transaction confirms/);
  assert.equal(panel.requests.length, 0);
});

test("confirmed reset shows its own result without asking the holder to reset again or complete setup", () => {
  const value = state(); value.status.landlord!.baseline = value.status.dividendBalance;
  const panel = closedPanel(value, value, true, { lastTransaction: { signature: "reset-result", action: "reset" } });
  assert.match(panel.html, /role="status"><h4>Balance reset confirmed/);
  assert.match(panel.html, /Collection waits for fresh eligibility checks and new rewards/);
  assert.match(panel.html, /https:\/\/solscan.io\/tx\/reset-result/);
  assert.doesNotMatch(panel.html, /Review balance reset in wallet/);
  assert.doesNotMatch(panel.html, /aria-label="Pledge setup"/);
  assert.match(panel.html, />Stop collection<|>Revoke PUMP approval</);
  assert.equal(panel.requests.length, 0);
});

test("existing holders can find Leave without expanding recovery when public enrollment opens", () => {
  for (const change of [
    () => {},
    (value: ReturnType<typeof state>) => { value.holding.consent!.enabled = false; },
    (value: ReturnType<typeof state>) => { value.status.landlord = null; },
  ]) {
    const value = state(); change(value);
    const panel = closedPanel(value, value, true, { enrollmentOpen: true });
    assert.match(panel.html, /<details open=""><summary>Independent recovery controls<\/summary>/);
    assert.match(panel.html, />Leave the pledge<\/button>/);
    assert.match(panel.html, /Leaving removes your pledge registration and PUMP approval/);
    assert.equal(panel.requests.length, 0);
  }
});

test("a wallet without an endowment pledge or approval sees neither Leave nor its explanation", () => {
  const value = state();
  value.status.landlord = null;
  value.status.delegate = null;
  value.status.delegatedToEndowment = false;
  value.holding.consent = null;
  for (const enrollmentOpen of [false, true]) {
    const panel = closedPanel(value, value, true, { enrollmentOpen });
    assert.doesNotMatch(panel.html, /Leave the pledge|Leaving removes/);
    assert.equal(panel.requests.length, 0);
  }
});
