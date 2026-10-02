/** In-memory finalized RPC bank built from the public Rust/LiteSVM fixture.
 * Token movements below are scenarios, not a substitute for on-chain execution. */
import { address, getBase58Decoder, type Address } from "@solana/kit";
import fixture from "../fixtures/holding-chain.json" with { type: "json" };
import { base64ToBytes, type Instance } from "../../lib/endowment.ts";
import { common, holdPda } from "../../lib/holding/client.ts";
import { concat, decodeAccount, encode, schema } from "../../lib/holding/codec.ts";
import type { Config, Landlord, Policy, Consent, Receipt } from "../../lib/holding/types.ts";
import type { Distribution, ParsedTransaction, SourcePolicy } from "../../lib/reporter/types.ts";
import type { RpcCall } from "../../lib/reporter/rpc.ts";
export async function holdingBank() {
  const inst: Instance = {
    program: address(fixture.program), config: address(fixture.config),
    coinMint: address(fixture.coinMint), dividendMint: address(fixture.dividendMint),
    coinTokenProgram: address(fixture.coinTokenProgram), dividendTokenProgram: address(fixture.dividendTokenProgram),
  };
  const owner = address(fixture.owner), a = await common(inst, owner);
  const records: Record<string, { owner: string; data: string[] }> = structuredClone(fixture.records);
  const read = <T,>(type: string, key: string) => decodeAccount<T>(type, base64ToBytes(records[key].data[0]));
  const write = (type: string, key: string, value: unknown) => {
    records[key] = { owner: inst.program, data: [Buffer.from(concat(Uint8Array.from(schema.accounts[type]),
      encode({ defined: { name: type } }, value))).toString("base64"), "base64"] };
  };
  const token = (key: string, amount: bigint) => {
    const bytes = Buffer.from(records[key].data[0], "base64");
    bytes.writeBigUInt64LE(amount, 64); records[key].data[0] = bytes.toString("base64");
  };
  const config = read<Config>("Config", inst.config), policy = read<Policy>("CollectionPolicy", a.policy),
    consent = read<Consent>("CollectionConsent", a.consent), landlord = read<Landlord>("Landlord", a.landlord);
  const receiptKey = await holdPda(inst, "receipt", owner, 0n);
  const receipt = read<Receipt>("PendingCollection", receiptKey);
  let now = 1800000000, slot = 10, balance = 20n;
  const transactions: ParsedTransaction[] = [], wires: string[] = [], feed = new Map<string, Distribution>();
  const source: SourcePolicy = { mint: inst.dividendMint, rewardMint: inst.coinMint,
    tokenProgram: inst.dividendTokenProgram, authority: fixture.collector, source: fixture.pool };
  Object.assign(config, { active: true, retired: false, paused_until: 0n, pause_started_at: 0n,
    milestone_reached: false, last_count_at: BigInt(now), reward_index: 1_000_000_000_000n,
    reward_marks: [{ at: BigInt(now), index: 0n }, { at: 0n, index: 0n }, { at: 0n, index: 0n }] });
  Object.assign(config.params, { allowance_margin_bps: 10000, max_rewards_per_day: 1_000_000n });
  Object.assign(landlord, { baseline: 20n, index_at: 0n, allowance: 0n, counted_amount: 100n, first_collection_nonce: 0n });
  Object.assign(consent, { enabled: true, next_nonce: 0n, started_at: BigInt(now) });
  policy.pending = 0n;
  const sync = () => {
    write("Config", inst.config, config); write("CollectionPolicy", a.policy, policy);
    write("CollectionConsent", a.consent, consent); write("Landlord", a.landlord, landlord);
    token(a.dividend_account, balance); token(a.pending_vault, policy.pending);
    const clock = Buffer.alloc(40); clock.writeBigInt64LE(BigInt(now), 32);
    records.SysvarC1ock11111111111111111111111111111111 = {
      owner: "Sysvar1111111111111111111111111111111111111", data: [clock.toString("base64"), "base64"],
    };
  };
  const move = (kind: "reward" | "buy" | "spend" | "sweep" | "refund", amount: bigint) => {
    slot++; now++;
    const before = balance;
    const outgoing = kind === "spend" || kind === "sweep";
    balance += outgoing ? -amount : amount;
    const signature = `scenario${slot}`;
    const tokenBalance = (value: bigint) => ({ accountIndex: 0, mint: inst.dividendMint, owner,
      programId: inst.dividendTokenProgram, uiTokenAmount: { amount: value.toString(), decimals: 6 } });
    const tx: ParsedTransaction = {
      slot, blockTime: now, transaction: { signatures: [signature], message: {
        accountKeys: [{ pubkey: a.dividend_account, signer: false }, { pubkey: source.authority, signer: true }],
        instructions: [{ programId: inst.dividendTokenProgram, parsed: { type: "transferChecked", info: {
          source: outgoing ? a.dividend_account : kind === "reward" ? source.source : a.pending_vault,
          destination: outgoing ? a.pending_vault : a.dividend_account,
          authority: outgoing ? owner : source.authority, mint: inst.dividendMint,
          tokenAmount: { amount: amount.toString(), decimals: 6 },
        } } }],
      } }, meta: { err: null, preTokenBalances: [tokenBalance(before)], postTokenBalances: [tokenBalance(balance)], innerInstructions: [] },
    };
    if (kind === "reward") feed.set(signature, { signature, mint: inst.coinMint, quoteMint: inst.dividendMint, amountRaw: amount.toString() });
    if (kind === "sweep") {
      tx.transaction.message.instructions.unshift({ programId: inst.program,
        accounts: schema.instructions.sweep.accounts.map(m => m.name === "receipt" ? receiptKey : m.name),
        data: getBase58Decoder().decode(Uint8Array.from(schema.instructions.sweep.discriminator)),
      });
      Object.assign(receipt, { amount, collected_at: BigInt(now), release_at: BigInt(now + 86400),
        refund_at: BigInt(now + 259200), consent_epoch: consent.epoch, nonce: consent.next_nonce });
      consent.next_nonce++; policy.pending += amount;
    }
    transactions.push(tx); sync();
  };
  const rpc = (async (method: string, params: unknown[]) => {
    sync();
    if (method === "getAccountInfo") return { value: records[String(params[0])] ?? null };
    if (method === "getMultipleAccounts") return { context: { slot }, value: (params[0] as string[]).map(k => records[k] ?? null) };
    if (method === "getSignaturesForAddress") {
      const limit = (params[1] as { limit: number }).limit;
      return [...transactions].reverse().slice(0, limit).map(tx => ({ signature: tx.transaction.signatures[0], slot: tx.slot, err: null, confirmationStatus: "finalized" }));
    }
    if (method === "getTransaction") return transactions.find(tx => tx.transaction.signatures[0] === params[0]) ?? null;
    if (method === "sendTransaction") { wires.push(String(params[0])); return "submitted"; }
    if (method === "getSignatureStatuses") return { value: [{ confirmationStatus: "finalized", err: null }] };
    throw new Error(`Unexpected RPC ${method}`);
  }) as RpcCall;
  sync();
  return { inst, owner, a, config, landlord, policy, consent, receipt, receiptKey, source, feed, rpc, wires, move,
    removePool: () => { delete records[config.pool]; },
    time: () => now, advance: (seconds: number) => { now += seconds; slot++; sync(); },
    receipts: () => [{ address: receiptKey as Address, receipt }],
  };
}
