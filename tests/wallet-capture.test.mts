import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { address, blockhash, compileTransaction, createClient, createTransactionMessage, getBase64Encoder,
  getTransactionDecoder, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
  type Transaction, type TransactionModifyingSigner } from "@solana/kit";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { captureWalletRequests, type WalletCapture } from "../lib/wallet-capture.ts";
import fixture from "./fixtures/holding-chain.json" with { type: "json" };

const owner = address(fixture.owner);
const hash = blockhash("11111111111111111111111111111111");
function unsigned(): Transaction {
  return compileTransaction(setTransactionMessageLifetimeUsingBlockhash({ blockhash: hash, lastValidBlockHeight: 1000n },
    setTransactionMessageFeePayer(owner, createTransactionMessage({ version: 0 }))));
}

test("capture substitutes the signer, preserves bytes, and never invokes the wallet", async () => {
  let called = 0; let report: WalletCapture | undefined;
  const wallet = { address: owner, modifyAndSignTransactions: async () => { called++; return []; } };
  const captured = captureWalletRequests(value => { report = value; })({ identity: wallet, payer: wallet });
  assert.equal(captured.identity, captured.payer);
  assert.equal("signAndSendTransactions" in captured.identity, false);
  const transaction = unsigned();
  await assert.rejects((captured.identity as TransactionModifyingSigner).modifyAndSignTransactions([transaction]), /WALLET_CAPTURE_ONLY/);
  assert.equal(called, 0);
  assert.equal(report?.signed, false); assert.equal(report?.submitted, false);
  const decoded = getTransactionDecoder().decode(getBase64Encoder().encode(report!.transactions[0].base64));
  assert.deepEqual(decoded.messageBytes, transaction.messageBytes);
  assert.equal(Object.values(decoded.signatures).every(value => value === null), true);
});

test("capture refuses signed transactions and unexpected required signers", async () => {
  let exported = 0;
  const wallet = { address: owner, modifyAndSignTransactions: async () => { throw new Error("Real signer called"); } };
  const c = captureWalletRequests(() => { exported++; })({ identity: wallet, payer: wallet });
  const sign = (tx: Transaction) => (c.identity as TransactionModifyingSigner).modifyAndSignTransactions([tx]);
  const signed = { ...unsigned(), signatures: { [owner]: new Uint8Array(64).fill(1) } } as unknown as Transaction;
  await assert.rejects(sign(signed), /one unsigned owner signature/);
  const extra = { ...unsigned(), signatures: { [owner]: null, [fixture.collector]: null } } as Transaction;
  await assert.rejects(sign(extra), /one unsigned owner signature/);
  assert.equal(exported, 0);
});

test("the actual RPC executor estimates resources then captures without sending or signing", async () => {
  const methods: string[] = []; let walletCalls = 0; let report: WalletCapture | undefined;
  const server = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body); methods.push(request.method);
    const value = request.method === "getLatestBlockhash" ? { blockhash: hash, lastValidBlockHeight: 1000 }
      : request.method === "simulateTransaction" ? { err: null, logs: [], unitsConsumed: 18000, returnData: null }
      : null;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id,
      ...(value ? { result: { context: { slot: 100 }, value } } : { error: { code: -32601, message: "Unexpected method" } }) }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const wallet = { address: owner, modifyAndSignTransactions: async () => { walletCalls++; return []; } };
    const client = await createClient().use(() => ({ identity: wallet, payer: wallet }))
      .use(captureWalletRequests(value => { report = value; }))
      .use(solanaRpc({ rpcUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, transactionConfig: { version: 0 } }));
    await assert.rejects(client.sendTransaction([{ programAddress: address("11111111111111111111111111111111"), data: new Uint8Array([0]) }]));
    assert.ok(report); assert.equal(report.transactions.length, 1);
    assert.equal(walletCalls, 0);
    assert.deepEqual(methods, ["getLatestBlockhash", "simulateTransaction"]);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
