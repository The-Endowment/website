import { address, getBase58Decoder, isSome, type Address } from "@solana/kit";
import { getTokenDecoder } from "@solana-program/token-2022";
import {
  base64ToBytes,
  CPMM_PROGRAM,
  parsePool,
  type Instance,
  type PoolAccounts,
} from "../endowment.ts";
import type { RpcCall } from "../reporter/rpc.ts";
import type { Snapshot } from "../reporter/snapshot.ts";
import { common, holdPda } from "./client.ts";
import { decodeAccount, schema } from "./codec.ts";
import type { Config, Consent, Landlord, Policy, Receipt } from "./types.ts";
type Account = { owner: string; data: [string, string] };
export type HoldSnapshot = Snapshot & {
  goalReached: boolean;
  config: Config;
  policy: Policy;
  consent: Consent | null;
  landlord: Landlord | null;
  pool: PoolAccounts;
};
const CLOCK = address("SysvarC1ock11111111111111111111111111111111");
const U64_MAX = (1n << 64n) - 1n;
export function accountBytes(value: Account | null, owner: string) {
  if (!value || value.owner !== owner || value.data[1] !== "base64")
    throw new Error("Missing account or wrong owner/encoding");
  return base64ToBytes(value.data[0]);
}
export async function holdSnapshot(
  rpc: RpcCall,
  inst: Instance,
  owner: Address,
  minSlot = 0,
): Promise<HoldSnapshot> {
  const a = await common(inst, owner);
  const first = await rpc<{ value: Account | null }>("getAccountInfo", [
    inst.config,
    { encoding: "base64", commitment: "finalized" },
  ]);
  const initial = decodeAccount<Config>(
    "Config",
    accountBytes(first.value, inst.program),
  );
  const keys = [
    inst.config,
    a.policy,
    a.consent,
    a.landlord,
    a.dividend_account,
    a.dividend_vault,
    a.pending_vault,
    a.coin_vault,
    CLOCK,
    initial.pool,
  ];
  const bank = await rpc<{
    context: { slot: number };
    value: (Account | null)[];
  }>("getMultipleAccounts", [
    keys,
    { encoding: "base64", commitment: "finalized", minContextSlot: minSlot },
  ]);
  if (
    bank.value.length !== keys.length ||
    !Number.isSafeInteger(bank.context.slot) ||
    bank.context.slot < minSlot
  )
    throw new Error("Incomplete or stale bank");
  const [c, p, co, l, s, v, held, coin, clock, pool] = bank.value;
  const config = decodeAccount<Config>("Config", accountBytes(c, inst.program));
  const policy = decodeAccount<Policy>(
    "CollectionPolicy",
    accountBytes(p, inst.program),
  );
  const consent = co
    ? decodeAccount<Consent>(
        "CollectionConsent",
        accountBytes(co, inst.program),
      )
    : null;
  const landlord = l
    ? decodeAccount<Landlord>("Landlord", accountBytes(l, inst.program))
    : null;
  if (
    config.version !== 3 ||
    config.pool !== initial.pool ||
    config.coin_mint !== inst.coinMint ||
    config.dividend_mint !== inst.dividendMint ||
    policy.config !== inst.config ||
    (consent && (consent.config !== inst.config || consent.owner !== owner)) ||
    (landlord &&
      (landlord.version !== 3 ||
        landlord.config !== inst.config ||
        landlord.owner !== owner ||
        landlord.dividend_account !== a.dividend_account ||
        landlord.coin_account !== a.coin_account))
  )
    throw new Error("Account identity or version mismatch");
  const token = (
    acc: Account | null,
    program: string,
    mint: string,
    owner: string,
  ) => {
    const t = getTokenDecoder().decode(accountBytes(acc, program));
    if (t.owner !== owner || t.mint !== mint)
      throw new Error("Wrong token owner/mint");
    return t;
  };
  const source = s
    ? token(s, inst.dividendTokenProgram, inst.dividendMint, owner)
    : null;
  const treasury = token(
    v,
    inst.dividendTokenProgram,
    inst.dividendMint,
    a.authority,
  );
  const pending = token(
    held,
    inst.dividendTokenProgram,
    inst.dividendMint,
    a.policy,
  );
  const principal = token(
    coin,
    inst.coinTokenProgram,
    inst.coinMint,
    a.authority,
  );
  if (pending.amount < policy.pending)
    throw new Error("Pending contributions are not fully backed");
  const bytes = accountBytes(
    clock,
    "Sysvar1111111111111111111111111111111111111",
  );
  const now = Number(
    new DataView(bytes.buffer, bytes.byteOffset).getBigInt64(32, true),
  );
  if (!Number.isSafeInteger(now) || Math.abs(Date.now() / 1000 - now) > 120)
    throw new Error("Stale chain clock");
  const complete =
    config.milestone_reached || principal.amount >= config.contribution_cap;
  const delegated =
    source && isSome(source.delegate) && source.delegate.value === a.authority;
  const active = Boolean(
    consent?.enabled &&
      landlord &&
      delegated &&
      !complete &&
      !config.retired &&
      BigInt(now) >= config.paused_until &&
      config.active &&
      (config.params.activate_bps === 0 ||
        BigInt(now) - config.last_count_at <= 3n * 86400n),
  );
  const cap =
    [
      config.params.max_buy_per_day,
      (config.params.max_buy_per_tx * 86400n) /
        (config.params.min_buy_interval_secs || 1n),
    ].reduce((a, b) => (a < b ? a : b)) * 3n;
  const room =
    (cap < U64_MAX ? cap : U64_MAX) - treasury.amount - policy.pending;
  const balance = source?.amount ?? 0n;
  const aboveBaseline =
    balance > (landlord?.baseline ?? balance)
      ? balance - landlord!.baseline
      : 0n;
  const index =
    config.reward_index > (landlord?.index_at ?? config.reward_index)
      ? config.reward_index - landlord!.index_at
      : 0n;
  const earned =
    (landlord?.allowance ?? 0n) +
    ((landlord?.counted_amount ?? 0n) * index) / 1_000_000_000_000n;
  const allowance = [
    aboveBaseline,
    source?.delegatedAmount ?? 0n,
    config.params.allowance_margin_bps ? earned : U64_MAX,
  ].reduce((a, b) => (a < b ? a : b));
  return {
    goalReached: complete,
    config,
    policy,
    consent,
    landlord,
    pool: parsePool(accountBytes(pool, CPMM_PROGRAM)),
    slot: bank.context.slot,
    now,
    active,
    reason: active
      ? "Active refundable consent"
      : "Inactive: discard collection eligibility",
    // Count/epoch/pause changes and day boundaries discard uncertain carry-over.
    binding: [
      inst.config,
      owner,
      consent?.epoch ?? 0n,
      config.last_count_at,
      config.refresher_epoch,
      config.paused_until,
      Math.floor(now / 86400),
    ].join(":"),
    balance: balance.toString(),
    nonce: (consent?.next_nonce ?? 0n).toString(),
    allowance: allowance.toString(),
    capacity: (room > 0n ? room : 0n).toString(),
    consentId: (consent?.epoch ?? 0n).toString(),
    collectionEpoch: config.last_count_at.toString(),
    reporterEpoch: "0",
    reporter: policy.collector,
  };
}
export async function pendingReceipts(
  rpc: RpcCall,
  inst: Instance,
  owner?: Address,
): Promise<{ address: Address; receipt: Receipt }[]> {
  const rows = await rpc<{ pubkey: string; account: Account }[]>(
    "getProgramAccounts",
    [
      inst.program,
      {
        commitment: "finalized",
        encoding: "base64",
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: getBase58Decoder().decode(
                Uint8Array.from(schema.accounts.PendingCollection),
              ),
            },
          },
          { memcmp: { offset: 8, bytes: inst.config } },
          ...(owner ? [{ memcmp: { offset: 40, bytes: owner } }] : []),
        ],
      },
    ],
  );
  return Promise.all(
    rows.map(async (row) => {
      const receipt = decodeAccount<Receipt>(
        "PendingCollection",
        accountBytes(row.account, inst.program),
      );
      if (
        receipt.config !== inst.config ||
        (owner && receipt.owner !== owner) ||
        row.pubkey !==
          (await holdPda(inst, "receipt", receipt.owner, receipt.nonce))
      )
        throw new Error("Receipt identity mismatch");
      return { address: address(row.pubkey), receipt };
    }),
  );
}
