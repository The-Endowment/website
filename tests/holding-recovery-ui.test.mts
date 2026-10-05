import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, Fragment, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { address } from "@solana/kit";
import fixture from "./fixtures/holding-chain.json" with { type: "json" };
import type { Instance } from "../lib/endowment.ts";
import type { Holding } from "../lib/holding/wallet.ts";
import type { Receipt } from "../lib/holding/types.ts";
import { loadTsxModule } from "./support/tsx-render.mts";

const inst: Instance = {
  program: address(fixture.program), config: address(fixture.config),
  coinMint: address(fixture.coinMint), dividendMint: address(fixture.dividendMint),
  coinTokenProgram: address(fixture.coinTokenProgram), dividendTokenProgram: address(fixture.dividendTokenProgram),
};
const noop = () => {};
const solana = { formatTokens: (value: bigint) => (Number(value) / 1_000_000).toLocaleString("en-US") };
type HeldProps = {
  holding: Holding | null; error: string | null; busy: boolean;
  onRetry: () => void; onReclaim: (receipt: Receipt) => void;
};
const { HeldCollections } = loadTsxModule<{ HeldCollections: ComponentType<HeldProps> }>(
  "components/HeldCollections.tsx", { "@/lib/solana": solana },
);

function renderPanel(connected: boolean) {
  const { ConfiguredDelegatePanel } = loadTsxModule<{ ConfiguredDelegatePanel: ComponentType<{ inst: Instance }> }>(
    "components/DelegatePanel.tsx", {
      "@solana/kit-plugin-wallet/react": {
        useConnectedWallet: () => connected ? { account: { address: fixture.owner } } : null,
        useWallets: () => [{ name: "Test wallet" }],
        useConnect: () => ({ dispatch: noop, isRunning: false }),
        useDisconnect: () => ({ dispatch: noop }),
        WalletReadyGate: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
      },
      "@solana/react": { useAction: () => ({ dispatch: noop, isRunning: false }) },
      "@solana-program/token-2022": {},
      "@/components/WalletClient": { client: { rpc: {} } },
      "@/lib/endowment": {},
      "@/lib/holding/client": {},
      "@/lib/holding/wallet": {},
      "@/lib/holding/delegation": {},
      "@/lib/solana": solana,
      "@/lib/site": { DELEGATION_OPEN: false, DELEGATION_CLOSED_NOTE: "New pledges are closed.", links: { x: "https://example.com" } },
    },
  );
  // Real React state/effects are used. SSR leaves the dashboard at status=null,
  // exactly the state in which recovery previously disappeared.
  return renderToStaticMarkup(createElement(ConfiguredDelegatePanel, { inst }));
}
function renderedButton(html: string, label: string) {
  const button = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find((match) => match[2] === label);
  assert.ok(button, `Expected a rendered ${label} button`);
  return { disabled: /\bdisabled(?:=|\s|$)/.test(button[1]) };
}
function renderHeld(props: Partial<HeldProps>) {
  return renderToStaticMarkup(createElement(HeldCollections, {
    holding: null, error: null, busy: false, onRetry: noop, onReclaim: noop, ...props,
  }));
}

test("closed enrollment still renders wallet connection for recovery", () => {
  const html = renderPanel(false);
  assert.match(html, /New pledges and re-enrollment are closed/);
  assert.match(html, /Connect your wallet to manage a pledge or reclaim pending contributions/);
  assert.equal(renderedButton(html, "Test wallet").disabled, false);
});

test("closed enrollment with no dashboard data leaves independent Stop and Revoke enabled", () => {
  const html = renderPanel(true);
  assert.match(html, /Checking held contributions/);
  assert.match(html, /Independent recovery controls/);
  assert.equal(renderedButton(html, "Stop collection").disabled, false);
  assert.equal(renderedButton(html, "Revoke PUMP approval").disabled, false);
  assert.equal(renderedButton(html, "Delegate my PUMP rewards").disabled, true);
  assert.doesNotMatch(html, /No pending contributions found/);
});

test("an unreleased contribution remains reclaimable after its first 24 hours", () => {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const receipt: Receipt = {
    config: inst.config, owner: address(fixture.owner), payer: address(fixture.collector),
    nonce: 0n, consent_epoch: 1n, amount: 1_000_000n,
    collected_at: now - 36n * 3600n, release_at: now - 12n * 3600n, refund_at: now + 36n * 3600n,
    collection_evidence: Array(32).fill(0), reviewed: true, approved_amount: 1_000_000n,
    review_evidence: Array(32).fill(0), bump: 255,
  };
  const holding: Holding = { ready: true, consent: null, receipts: [receipt] };
  const html = renderHeld({ holding });
  assert.match(html, /Being held: 1 PUMP/);
  assert.match(html, /including after 24 hours/);
  assert.equal(renderedButton(html, "Take it back").disabled, false);
  assert.equal(renderedButton(renderHeld({ holding, busy: true }), "Take it back").disabled, true);
});

test("a failed receipt read shows an error and retry instead of claiming no held funds", () => {
  const html = renderHeld({ error: "Couldn't load held contributions. This does not mean there are none." });
  assert.match(html, /role="alert"/);
  assert.match(html, /This does not mean there are none/);
  assert.equal(renderedButton(html, "Retry").disabled, false);
  assert.doesNotMatch(html, /No pending contributions found|Being held:/);
});
