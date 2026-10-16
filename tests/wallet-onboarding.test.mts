import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { enrollmentWalletIssue, parseWalletAddress, phantomBrowseUrl, wasWalletDeclined } from "../lib/wallet-onboarding.ts";
import { loadTsxModule } from "./support/tsx-render.mts";
import fixture from "./fixtures/holding-chain.json" with { type: "json" };

const owner = fixture.owner;
const other = fixture.collector;

test("Fomo address check uses the full address and accepts only public Solana addresses", () => {
  assert.equal(parseWalletAddress(` ${owner}\n`), owner);
  for (const invalid of ["", "HpsR…gDNf", "https://example.com", "0x123", "word ".repeat(12), "a".repeat(88)]) {
    assert.equal(parseWalletAddress(invalid), null);
  }
  assert.equal(enrollmentWalletIssue(owner, owner), null);
  assert.match(enrollmentWalletIssue(other, owner)!, /different wallet/);
  assert.equal(enrollmentWalletIssue(other, null), null);
});

test("Phantom mobile handoff drops query and fragment data and refuses local or non-HTTPS pages", () => {
  const link = phantomBrowseUrl("https://example.com/delegate?rpc=private#token");
  assert.equal(link, "https://phantom.com/ul/browse/https%3A%2F%2Fexample.com%2Fdelegate?ref=https%3A%2F%2Fexample.com");
  for (const page of ["http://example.com/delegate", "https://localhost/delegate", "https://app.local/delegate", "https://127.0.0.1:3000/delegate", "https://[::1]/delegate", "https://user:password@example.com/delegate", "javascript:alert(1)"]) {
    assert.equal(phantomBrowseUrl(page), null);
  }
});

test("explicit wallet rejection is separate from an unknown confirmation outcome", () => {
  assert.equal(wasWalletDeclined({ code: 4001 }), true);
  assert.equal(wasWalletDeclined({ cause: { code: "4001" } }), true);
  assert.equal(wasWalletDeclined(new Error("RPC confirmation timed out")), false);
  const cycle: { cause?: unknown } = {};
  cycle.cause = cycle;
  assert.equal(wasWalletDeclined(cycle), false);
});

type Props = {
  phantomAvailable: boolean; connecting: boolean; connectionError: string | null;
  onPhantom: (expected: string | null) => void; manualWallets: ReactNode;
};
const { WalletOnboarding } = loadTsxModule<{ WalletOnboarding: ComponentType<Props> }>("components/WalletOnboarding.tsx", {});

test("no installed wallet still gives Phantom setup, an honest Fomo route, and manual connection", () => {
  let connections = 0;
  const html = renderToStaticMarkup(createElement(WalletOnboarding, {
    phantomAvailable: false, connecting: false, connectionError: null,
    onPhantom: () => { connections++; }, manualWallets: createElement("p", null, "No wallet detected"),
  }));
  assert.match(html, /Connect Phantom/);
  assert.match(html, /I use Fomo/);
  assert.match(html, /Guided setup through Phantom/);
  assert.match(html, /Manual connection \/ another wallet/);
  assert.doesNotMatch(html, /Connect Fomo|type="password"|checked=""/);
  assert.equal(connections, 0);
});

test("connection failure is visible and requesting a connection disables both main choices", () => {
  const html = renderToStaticMarkup(createElement(WalletOnboarding, {
    phantomAvailable: true, connecting: true, connectionError: "Connection wasn't completed.",
    onPhantom: () => {}, manualWallets: null,
  }));
  assert.match(html, /role="alert"/);
  assert.equal([...html.matchAll(/<button[^>]*disabled=""/g)].length, 2);
  assert.match(html, /Confirm the connection in your wallet/);
});
