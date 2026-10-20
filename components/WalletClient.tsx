"use client";

import { createClient } from "@solana/kit";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { walletSigner } from "@solana/kit-plugin-wallet";
import { ClientProvider } from "@solana/react";
import { useEffect, useState, type ReactNode } from "react";
import { RPC_URL } from "@/lib/solana";
import { captureWalletRequests, type WalletCapture } from "@/lib/wallet-capture";

// Capture replaces every action's signer, including recovery. Never enable it
// in a production build, even if a hosting environment accidentally sets it.
export const WALLET_CAPTURE_ONLY = process.env.NODE_ENV === "development"
  && process.env.NEXT_PUBLIC_WALLET_CAPTURE_ONLY === "true";
const CAPTURE_EVENT = "endowment:unsigned-wallet-capture";

function saveCapture(report: WalletCapture) {
  window.dispatchEvent(new CustomEvent(CAPTURE_EVENT, { detail: report }));
}

// One client for the delegate page. The connected wallet signs and pays.
// Version 0 transactions: every major wallet can sign them, and ours are small.
export const client = createClient()
  .use(walletSigner({ chain: "solana:mainnet" }))
  .use(c => WALLET_CAPTURE_ONLY ? captureWalletRequests(saveCapture)(c) : c)
  .use(solanaRpc({ rpcUrl: RPC_URL, transactionConfig: { version: 0 } }));

export type AppClient = Awaited<typeof client>;

export function WalletProvider({ children }: { children: ReactNode }) {
  const [capture, setCapture] = useState<WalletCapture | null>(null);
  useEffect(() => {
    if (!WALLET_CAPTURE_ONLY) return;
    const receive = (event: Event) => setCapture((event as CustomEvent<WalletCapture>).detail);
    window.addEventListener(CAPTURE_EVENT, receive);
    return () => window.removeEventListener(CAPTURE_EVENT, receive);
  }, []);
  const download = () => {
    if (!capture) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(capture, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = "endowment-unsigned-enrollment.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <ClientProvider client={client}>
    <div className="row-body" style={{ minWidth: 0 }}>
    {WALLET_CAPTURE_ONLY && <aside className="notice" role="status">
      <strong>Diagnostic mode — no signing or sending</strong>
      <p>Connect your wallet, then capture enrollment below. This page stops before requesting a wallet signature. All transaction actions are disabled at the signing boundary.</p>
      {capture && <><p>Unsigned request captured. No wallet signing request was made and nothing was sent to the blockchain. The report contains public addresses and transaction data.</p>
        <button type="button" className="button" onClick={download}>Download unsigned request</button></>}
    </aside>}
    {children}
    </div>
  </ClientProvider>;
}
