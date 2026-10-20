import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { createClient, address, getAddressEncoder } from "@solana/kit";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { getWallets } from "@wallet-standard/app";
import * as capture from "../lib/wallet-capture.ts";
import { wasWalletDeclined } from "../lib/wallet-onboarding.ts";
import type { AppClient } from "../components/WalletClient.tsx";
import { loadTsxModule } from "./support/tsx-render.mts";
import fixture from "./fixtures/holding-chain.json" with { type: "json" };

// Node's wallet export is deliberately an inert SSR stub. Exercise the actual
// browser plugin with a registered Wallet Standard test wallet instead.
const { walletSigner } = await import(new URL("./index.browser.mjs", import.meta.resolve("@solana/kit-plugin-wallet")).href) as typeof import("@solana/kit-plugin-wallet");

function loadClient(environment: string | undefined, flag: string | undefined, rpcUrl: string) {
  const env = process.env as Record<string, string | undefined>;
  const previous = { node: env.NODE_ENV, capture: env.NEXT_PUBLIC_WALLET_CAPTURE_ONLY };
  try {
    if (environment === undefined) delete env.NODE_ENV; else env.NODE_ENV = environment;
    if (flag === undefined) delete env.NEXT_PUBLIC_WALLET_CAPTURE_ONLY; else env.NEXT_PUBLIC_WALLET_CAPTURE_ONLY = flag;
    return loadTsxModule<{
      WALLET_CAPTURE_ONLY: boolean;
      client: AppClient | PromiseLike<AppClient>;
    }>("components/WalletClient.tsx", {
      "@solana/kit": { createClient },
      "@solana/kit-plugin-wallet": { walletSigner },
      "@solana/kit-plugin-rpc": { solanaRpc },
      "@/lib/solana": { RPC_URL: rpcUrl },
      "@/lib/wallet-capture": capture,
    });
  } finally {
    if (previous.node === undefined) delete env.NODE_ENV; else env.NODE_ENV = previous.node;
    if (previous.capture === undefined) delete env.NEXT_PUBLIC_WALLET_CAPTURE_ONLY; else env.NEXT_PUBLIC_WALLET_CAPTURE_ONLY = previous.capture;
  }
}

test("the actual wallet client ignores capture outside explicitly enabled development", async () => {
  for (const [environment, flag, expected] of [
    ["production", "true", false], ["production", undefined, false],
    ["test", "true", false], [undefined, "true", false],
    ["development", "false", false], ["development", undefined, false],
    ["development", "true", true],
  ] as const) {
    const loaded = loadClient(environment, flag, "http://127.0.0.1:1");
    assert.equal(loaded.WALLET_CAPTURE_ONLY, expected, `${environment}/${flag}`);
    (await loaded.client)[Symbol.dispose]();
  }
});

test("real wallet plugin order captures in development but leaves production recovery signing available", async () => {
  const methods: string[] = [];
  let walletCalls = 0;
  const reports: capture.WalletCapture[] = [];
  const owner = address(fixture.owner);
  const account = { address: owner, publicKey: getAddressEncoder().encode(owner),
    chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signAndSendTransaction"] } as const;
  const decline = async () => { walletCalls++; throw Object.assign(new Error("User rejected the request"), { code: 4001 }); };
  const wallet = {
    version: "1.0.0", name: "Diagnostic test wallet", icon: "data:image/svg+xml;base64,PHN2Zy8+",
    chains: ["solana:mainnet"], accounts: [account],
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
      "standard:events": { version: "1.0.0", on: () => () => {} },
      "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: [0], signTransaction: decline },
      "solana:signAndSendTransaction": { version: "1.0.0", supportedTransactionVersions: [0], signAndSendTransaction: decline },
    },
  } as const;
  const unregister = getWallets().register(wallet);
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const events = new EventTarget();
  events.addEventListener("endowment:unsigned-wallet-capture", event => {
    reports.push((event as CustomEvent<capture.WalletCapture>).detail);
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: events });
  const server = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body); methods.push(request.method);
    const value = request.method === "getLatestBlockhash" ? { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1000 }
      : request.method === "simulateTransaction" ? { err: null, logs: [], unitsConsumed: 18000, returnData: null }
      : null;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id,
      ...(value ? { result: { context: { slot: 100 }, value } } : { error: { code: -32601, message: "Unexpected method" } }) }));
  });
  const clients: AppClient[] = [];
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    for (const environment of ["development", "production"]) {
      const client = await loadClient(environment, "true", url).client;
      clients.push(client);
      await client.wallet.whenReady();
      const found = client.wallet.getState().wallets.find(w => w.name === wallet.name);
      assert.ok(found);
      await client.wallet.connect(found);
      assert.equal(client.identity.address, owner);
      await assert.rejects(client.sendTransaction([{ programAddress: address("11111111111111111111111111111111"), data: new Uint8Array([0]) }]),
        error => environment === "development" ? capture.wasWalletCaptureStopped(error) : wasWalletDeclined(error));
      assert.equal(walletCalls, environment === "development" ? 0 : 1);
      assert.equal(reports.length, 1);
      assert.equal(reports[0].signed, false);
      assert.equal(reports[0].submitted, false);
    }
    assert.equal(methods.includes("sendTransaction"), false);
  } finally {
    for (const client of clients) client[Symbol.dispose]();
    unregister();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("only a deliberate capture stop, including a wrapped one, gets capture confirmation", () => {
  const stopped = new capture.WalletCaptureStoppedError();
  assert.equal(capture.wasWalletCaptureStopped(stopped), true);
  assert.equal(capture.wasWalletCaptureStopped(new Error("SDK wrapper", { cause: stopped })), true);
  for (const error of [new Error("Different Fomo wallet"), new Error("Already registered"),
    new Error("RPC unavailable"), { code: 4001 }, new Error("WALLET_CAPTURE_ONLY: provider text")]) {
    assert.equal(capture.wasWalletCaptureStopped(error), false);
  }
  const cycle: { cause?: unknown } = {}; cycle.cause = cycle;
  assert.equal(capture.wasWalletCaptureStopped(cycle), false);
});
