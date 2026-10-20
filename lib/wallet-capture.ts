import { extendClient, getBase64Decoder, getTransactionEncoder, type Transaction, type TransactionSigner } from "@solana/kit";

export class WalletCaptureStoppedError extends Error {
  constructor() {
    super("WALLET_CAPTURE_ONLY: unsigned request captured; no signature or submission.");
    this.name = "WalletCaptureStoppedError";
  }
}

/** The executor can wrap our deliberate stop; unrelated failures are not captures. */
export function wasWalletCaptureStopped(error: unknown): boolean {
  const seen = new Set<object>();
  for (let current = error; current && typeof current === "object" && !seen.has(current);) {
    if (current instanceof WalletCaptureStoppedError) return true;
    seen.add(current);
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export type WalletCapture = {
  version: 1;
  capturedAt: string;
  source: "SDK signing boundary; stopped before the wallet";
  signer: string;
  signed: false;
  submitted: false;
  transactions: { base64: string; bytes: number }[];
};

/** Diagnostic replacement, never a wrapper that forwards to the real wallet.
 * It captures the executor's final unsigned bytes after resource estimation.
 * No RPC URLs, wallet secrets, provider errors or existing signatures are exported.
 */
export function captureWalletRequests(onCapture: (report: WalletCapture) => void | Promise<void>) {
  return <T extends { readonly identity: TransactionSigner; readonly payer: TransactionSigner }>(client: T) => {
    const cache = new Map<string, TransactionSigner>();
    const substitute = (signer: TransactionSigner): TransactionSigner => {
      const existing = cache.get(signer.address);
      if (existing) return existing;
      const replacement: TransactionSigner = Object.freeze({
        address: signer.address,
        modifyAndSignTransactions: async (transactions: readonly Transaction[]) => {
          if (transactions.length !== 1) throw new Error("Capture expects one enrollment transaction.");
          const encoded = transactions.map(transaction => {
            const entries = Object.entries(transaction.signatures);
            if (entries.length !== 1 || entries[0][0] !== signer.address || entries[0][1] !== null) {
              throw new Error("Capture requires one unsigned owner signature; nothing was exported.");
            }
            const bytes = getTransactionEncoder().encode(transaction);
            return { base64: getBase64Decoder().decode(bytes), bytes: bytes.length };
          });
          await onCapture({ version: 1, capturedAt: new Date().toISOString(),
            source: "SDK signing boundary; stopped before the wallet", signer: signer.address,
            signed: false, submitted: false, transactions: encoded });
          // Throwing here prevents both wallet invocation and RPC submission.
          throw new WalletCaptureStoppedError();
        },
      });
      cache.set(signer.address, replacement);
      return replacement;
    };
    return extendClient(client, {
      get identity() { return substitute(client.identity); },
      get payer() { return substitute(client.payer); },
    });
  };
}
