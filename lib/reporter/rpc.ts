import type { ParsedTransaction } from "./types.ts";
export type RpcCall = <T>(method: string, params: unknown[]) => Promise<T>;
export type SignatureRow = { signature: string; slot: number; err: unknown; confirmationStatus: string };
export function jsonRpc(url: string): RpcCall {
  const endpoint = new URL(url);
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && ["localhost", "127.0.0.1"].includes(endpoint.hostname))) throw new Error("RPC must use HTTPS");
  return async <T>(method: string, params: unknown[]) => {
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`RPC ${method} returned HTTP ${response.status}`);
    const result = await response.json() as { error?: { code: number }; result?: T };
    if (result.error || result.result === undefined) throw new Error(`RPC ${method} failed (${result.error?.code ?? "missing result"})`);
    return result.result;
  };
}
export async function latestCursor(rpc: RpcCall, source: string, slot: number): Promise<string | null> {
  const rows = await rpc<SignatureRow[]>("getSignaturesForAddress", [source, { commitment: "finalized", limit: 1, minContextSlot: slot }]);
  // A newer transaction arrived after the snapshot. Retry with a newer snapshot.
  if (rows[0] && rows[0].slot > slot) throw new Error("Account history advanced after the snapshot; retry");
  return rows[0]?.signature ?? null;
}
export async function history(rpc: RpcCall, source: string, cursor: string | null, fromSlot: number, toSlot: number): Promise<{ transactions: ParsedTransaction[]; cursor: string | null }> {
  const found: SignatureRow[] = []; let before: string | undefined, reached = false;
  for (let page = 0; page < 10 && !reached; page++) {
    const rows = await rpc<SignatureRow[]>("getSignaturesForAddress", [source, { commitment: "finalized", limit: 1_000, minContextSlot: toSlot, ...(before ? { before } : {}) }]);
    for (const row of rows) {
      if (row.signature === cursor || (cursor === null && row.slot <= fromSlot)) { reached = true; break; }
      if (row.slot > toSlot) throw new Error("Account history advanced after the snapshot; retry");
      if (row.slot <= fromSlot) throw new Error("Saved history cursor is missing");
      if (row.confirmationStatus !== "finalized") throw new Error("History includes an unfinalized transaction");
      found.push(row);
    }
    if (rows.length < 1_000) { if (cursor === null) reached = true; break; }
    if (rows.at(-1)?.signature === before) throw new Error("History pagination stalled");
    before = rows.at(-1)?.signature;
  }
  if (!reached) throw new Error("Transaction history gap or page budget exceeded");
  const transactions: ParsedTransaction[] = [];
  for (const row of [...found].reverse()) {
    const tx = await rpc<ParsedTransaction | null>("getTransaction", [row.signature, { commitment: "finalized", encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
    if (!tx || tx.slot !== row.slot || tx.transaction.signatures[0] !== row.signature) throw new Error("Missing or inconsistent finalized transaction");
    transactions.push(tx);
  }
  return { transactions, cursor: found[0]?.signature ?? cursor };
}
