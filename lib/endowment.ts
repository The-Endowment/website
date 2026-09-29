/**
 * The endowment program's client: addresses, account decoders and instruction
 * builders, written against the program source (programs/endowment/src). Used by
 * both the browser (opt-in, commitment bar, projects) and the keeper.
 */
import {
  AccountRole,
  address,
  fixDecoderSize,
  getAddressDecoder,
  getAddressEncoder,
  getBase58Decoder,
  getBooleanDecoder,
  getBytesDecoder,
  getI64Decoder,
  getProgramDerivedAddress,
  getStructDecoder,
  getU16Decoder,
  getU32Decoder,
  getU64Decoder,
  getU64Encoder,
  getU8Decoder,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";

/**
 * The only program IDs the site will ever talk to (audit L-01). The website
 * refuses any other value, even if an environment variable says otherwise.
 * Update this list only alongside a reviewed deploy.
 */
export const KNOWN_PROGRAM_IDS = ["5VBiPX39xFTgwRaUbC3F3HCuVcM3VkTuYDkxwrhYby2u"] as const;

function knownProgram(value: string | undefined): Address | null {
  if (!value) return null;
  if (!(KNOWN_PROGRAM_IDS as readonly string[]).includes(value)) {
    throw new Error(`Refusing unknown endowment program ID ${value}`);
  }
  return address(value);
}

/** Unset until launch; when set it must be one of KNOWN_PROGRAM_IDS. */
export const PROGRAM_ID: Address | null = knownProgram(process.env.NEXT_PUBLIC_ENDOWMENT_PROGRAM_ID);

export const PUMP_MINT = address("pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn");
export const PENIS_MINT = address("JE3HT7SbCgXDQWV6xp3oiiAisDzq4HyZ8wyEVBDCs45Z");

/**
 * The flagship, pinned (audit KW-09): the same constants the program derives
 * the flagship from (`FLAGSHIP_COIN_MINT`, `FLAGSHIP_CREATOR` in
 * programs/endowment/src/constants.rs). The creator is the all-zero placeholder
 * until it is set, in both places, before deploy.
 */
export const PROGRAM_FLAGSHIP_COIN_MINT = PENIS_MINT;
export const PROGRAM_FLAGSHIP_CREATOR = address("11111111111111111111111111111111"); // SET BEFORE DEPLOY
const PLACEHOLDER_CREATOR = "11111111111111111111111111111111";

/**
 * The wallet that created the $PENIS endowment, from the environment, checked
 * against the program's constant: a mismatch is refused, so a wrong or tampered
 * setting can never point landlords at another instance.
 */
function pinnedCreator(value: string | undefined): Address | null {
  if (!value) return null;
  if (value !== PROGRAM_FLAGSHIP_CREATOR) {
    throw new Error(`Refusing flagship creator ${value}: the program's flagship is ${PROGRAM_FLAGSHIP_CREATOR}`);
  }
  if (value === PLACEHOLDER_CREATOR) return null;
  return address(value);
}
export const FLAGSHIP_CREATOR: Address | null = pinnedCreator(process.env.NEXT_PUBLIC_ENDOWMENT_CREATOR);
export const CPMM_PROGRAM = address("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
export const LEGACY_TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

export const DISC = {
  registerLandlord: [51, 29, 33, 2, 132, 202, 221, 40],
  resyncBaseline: [119, 125, 19, 234, 225, 239, 52, 126],
  deregisterLandlord: [214, 69, 108, 218, 237, 143, 149, 135],
  pruneLandlord: [246, 56, 34, 9, 95, 107, 19, 188],
  sweep: [40, 23, 234, 175, 14, 61, 154, 177],
  buyback: [106, 117, 64, 30, 56, 69, 7, 45],
  beginCount: [119, 0, 58, 85, 81, 17, 62, 91],
  countLandlords: [16, 55, 45, 27, 207, 59, 13, 48],
  finishCount: [226, 69, 229, 200, 228, 181, 186, 170],
  refreshLandlords: [29, 213, 34, 6, 109, 63, 210, 36],
  resignRefresher: [91, 64, 75, 203, 145, 81, 19, 146],
  configAccount: [155, 12, 170, 224, 30, 250, 204, 130],
  landlordAccount: [84, 167, 79, 195, 204, 84, 46, 152],
};

/** Match `COUNT_INTERVAL_SECS`, `COUNT_TIMEOUT_SECS` and `ACTIVE_MAX_AGE_SECS` in the program's constants. */
export const COUNT_INTERVAL_SECS = 24 * 60 * 60;
export const COUNT_TIMEOUT_SECS = 4 * 60 * 60;
export const ACTIVE_MAX_AGE_SECS = 3 * 24 * 60 * 60;
/** Match `MAX_VAULT_DAYS_OF_BUYS`: sweeps stop filling the dividend vault past this many days of buys. */
export const MAX_VAULT_DAYS_OF_BUYS = 3;
/** Match `REQUIRED_ATTESTATIONS` and `MIN_ATTEST_SPACING_SECS`: a landlord counts after this many spaced refresher reads. */
export const REQUIRED_ATTESTATIONS = 3;
export const MIN_ATTEST_SPACING_SECS = 30 * 60;

/** The program's error codes the keeper reports by name (anchor: 6000 + index in `EndowmentError`). */
export const PROGRAM_ERRORS: Record<number, string> = {
  6008: "NothingToBuy",
  6011: "PriceImpactTooHigh",
  6012: "SlippageExceeded",
  6013: "BuyTooSoon",
  6028: "FeeTooHigh",
  6029: "TransferHookEnabled",
  6030: "TwapUnavailable",
  6031: "PriceAboveTwap",
  6032: "PoolSwapDisabled",
  6041: "VaultFrozen",
  6048: "PriceBelowTwap",
  6049: "FloorAboveQuote",
  6050: "NotAttested",
};
/** Match `MIN_DELEGATION` (u64::MAX / 2). */
export const MIN_DELEGATION = BigInt("9223372036854775807");
export const DEFAULT_ADDRESS = address("11111111111111111111111111111111");

const text = new TextEncoder();
const addressBytes = (a: Address) => getAddressEncoder().encode(a);

/** A PDA from one string label followed by addresses, matching the program's seeds. */
async function pda(program: Address, label: string, ...keys: Address[]) {
  const [p] = await getProgramDerivedAddress({
    programAddress: program,
    seeds: [text.encode(label), ...keys.map(addressBytes)],
  });
  return p;
}

export const configPda = (program: Address, coinMint: Address, creatorKey: Address) =>
  pda(program, "config", coinMint, creatorKey);
export const authorityPda = (program: Address, config: Address) => pda(program, "authority", config);
export const landlordPda = (program: Address, config: Address, owner: Address) =>
  pda(program, "landlord", config, owner);

export async function ata(owner: Address, mint: Address, tokenProgram: Address = TOKEN_2022_PROGRAM_ADDRESS) {
  const [a] = await findAssociatedTokenPda({ owner, mint, tokenProgram });
  return a;
}

/** The $PENIS endowment's config address, derived as the program does, or null before launch. */
export async function flagshipConfig(): Promise<Address | null> {
  if (!PROGRAM_ID || !FLAGSHIP_CREATOR) return null;
  return configPda(PROGRAM_ID, PROGRAM_FLAGSHIP_COIN_MINT, FLAGSHIP_CREATOR);
}

/** Whether a fetched config really is the flagship's (defence in depth before opt-in). */
export function isFlagshipConfig(config: EndowmentConfig) {
  return (
    FLAGSHIP_CREATOR !== null &&
    config.creator === FLAGSHIP_CREATOR &&
    config.coinMint === PENIS_MINT &&
    config.dividendMint === PUMP_MINT
  );
}

// ---- Account decoders (layouts from programs/endowment/src/state.rs) ----

const paramsDecoder = getStructDecoder([
  ["maxBuyPerTx", getU64Decoder()],
  ["maxBuyPerDay", getU64Decoder()],
  ["maxPriceImpactBps", getU16Decoder()],
  ["maxTwapDeviationBps", getU16Decoder()],
  ["minBuyAmount", getU64Decoder()],
  ["minBuyIntervalSecs", getI64Decoder()],
  ["tipBps", getU16Decoder()],
  ["buyBps", getU16Decoder()],
  ["activateBps", getU16Decoder()],
  ["deactivateBps", getU16Decoder()],
  ["minStakeBps", getU16Decoder()],
  ["refresher", getAddressDecoder()],
]);

const configDecoder = getStructDecoder([
  ["discriminator", fixDecoderSize(getBytesDecoder(), 8)],
  ["version", getU8Decoder()],
  ["creator", getAddressDecoder()],
  ["admin", getAddressDecoder()],
  ["pendingAdmin", getAddressDecoder()],
  ["guardian", getAddressDecoder()],
  ["coinMint", getAddressDecoder()],
  ["dividendMint", getAddressDecoder()],
  ["pool", getAddressDecoder()],
  ["bump", getU8Decoder()],
  ["authorityBump", getU8Decoder()],
  ["params", paramsDecoder],
  ["pendingParams", paramsDecoder],
  ["pendingEffectiveAt", getI64Decoder()],
  ["donationBps", getU16Decoder()],
  ["contributionCap", getU64Decoder()],
  ["pausedUntil", getI64Decoder()],
  ["retired", getBooleanDecoder()],
  ["retireAt", getI64Decoder()],
  ["milestoneReached", getBooleanDecoder()],
  ["active", getBooleanDecoder()],
  ["lastCountAt", getI64Decoder()],
  ["lastCountBps", getU16Decoder()],
  ["lastCommitted", getU64Decoder()],
  ["lastAttestedAt", getI64Decoder()],
  ["lastSweepAt", getI64Decoder()],
  ["landlordCount", getU32Decoder()],
  [
    "count",
    getStructDecoder([
      ["round", getU64Decoder()],
      ["open", getBooleanDecoder()],
      ["startedAt", getI64Decoder()],
      ["supply", getU64Decoder()],
      ["expected", getU32Decoder()],
      ["counted", getU32Decoder()],
      ["committed", getU64Decoder()],
      ["minStake", getU64Decoder()],
    ]),
  ],
  ["buyAllowance", getU64Decoder()],
  ["allowanceUpdatedAt", getI64Decoder()],
  ["lastBuyAt", getI64Decoder()],
  ["totalSwept", getU64Decoder()],
  ["totalDividendSpent", getU64Decoder()],
  ["totalCoinBought", getU64Decoder()],
  ["totalCoinRetained", getU64Decoder()],
  ["totalLiquidityDividend", getU64Decoder()],
  ["totalLiquidityCoin", getU64Decoder()],
  ["totalLpTokens", getU64Decoder()],
  ["totalTips", getU64Decoder()],
  ["totalDonated", getU64Decoder()],
  /** Bumped whenever the refresher changes; reads from an earlier epoch don't count (FC-R3-03). */
  ["refresherEpoch", getU32Decoder()],
]);

const landlordDecoder = getStructDecoder([
  ["discriminator", fixDecoderSize(getBytesDecoder(), 8)],
  ["version", getU8Decoder()],
  ["config", getAddressDecoder()],
  ["owner", getAddressDecoder()],
  ["dividendAccount", getAddressDecoder()],
  ["coinAccount", getAddressDecoder()],
  ["baseline", getU64Decoder()],
  ["totalContributed", getU64Decoder()],
  ["registeredAt", getI64Decoder()],
  ["lastSweepAt", getI64Decoder()],
  ["bump", getU8Decoder()],
  ["joinedRound", getU64Decoder()],
  ["countedRound", getU64Decoder()],
  ["countedAmount", getU64Decoder()],
  ["snapshot", getU64Decoder()],
  ["snapshotValid", getBooleanDecoder()],
  /** Spaced refresher reads since its last count; it counts at REQUIRED_ATTESTATIONS. */
  ["attestations", getU8Decoder()],
  ["lastAttestedAt", getI64Decoder()],
  /** The config's `refresherEpoch` when those reads were made. */
  ["attestationEpoch", getU32Decoder()],
]);

function hasDiscriminator(bytes: Uint8Array, disc: number[]) {
  return disc.every((b, i) => bytes[i] === b);
}

export type EndowmentConfig = ReturnType<typeof configDecoder.decode>;
export type LandlordRecord = ReturnType<typeof landlordDecoder.decode>;

/** A landlord's refresher reads, as the program counts them: only those made under the current refresher. */
export function attestationsOf(config: EndowmentConfig, record: LandlordRecord): number {
  return record.attestationEpoch === config.refresherEpoch ? record.attestations : 0;
}

/** The buy allowance right now, refilled as the program refills it (`math::refill`). */
export function refilledAllowance(config: EndowmentConfig, now: number): bigint {
  const elapsed = BigInt(Math.max(0, now - Number(config.allowanceUpdatedAt)));
  const refilled = config.buyAllowance + (elapsed * config.params.maxBuyPerDay) / BigInt(86_400);
  return refilled < config.params.maxBuyPerTx ? refilled : config.params.maxBuyPerTx;
}

export function decodeConfig(bytes: Uint8Array): EndowmentConfig | null {
  return hasDiscriminator(bytes, DISC.configAccount) ? configDecoder.decode(bytes) : null;
}
export function decodeLandlord(bytes: Uint8Array): LandlordRecord | null {
  return hasDiscriminator(bytes, DISC.landlordAccount) ? landlordDecoder.decode(bytes) : null;
}

export function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

type RpcLike = {
  getAccountInfo: (a: Address, c: { encoding: "base64" }) => { send: () => Promise<{ value: { data: [string, string] } | null }> };
};

/** Fetch and decode one account; null if it doesn't exist or isn't the expected type. */
export async function fetchDecoded<T>(rpc: unknown, account: Address, decode: (b: Uint8Array) => T | null): Promise<T | null> {
  const info = await (rpc as RpcLike).getAccountInfo(account, { encoding: "base64" }).send();
  return info.value ? decode(base64ToBytes(info.value.data[0])) : null;
}

// ---- Instruction builders (account orders from programs/endowment/src/instructions) ----

const W = AccountRole.WRITABLE;
const R = AccountRole.READONLY;
type Meta = { address: Address; role: AccountRole; signer?: TransactionSigner };

function ix(program: Address, disc: number[], accounts: Meta[], args: Uint8Array = new Uint8Array()): Instruction {
  const data = new Uint8Array(disc.length + args.length);
  data.set(disc);
  data.set(args, disc.length);
  return { programAddress: program, accounts, data } as Instruction;
}

const signer = (s: TransactionSigner, writable: boolean): Meta => ({
  address: s.address,
  role: writable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER,
  signer: s,
});

export type Instance = {
  program: Address;
  config: Address;
  coinMint: Address;
  dividendMint: Address;
  coinTokenProgram: Address;
  dividendTokenProgram: Address;
};

export async function registerLandlordIx(
  inst: Instance,
  owner: TransactionSigner,
  dividendAccount: Address,
  coinAccount: Address,
) {
  return ix(inst.program, DISC.registerLandlord, [
    signer(owner, true),
    { address: inst.config, role: W },
    { address: await authorityPda(inst.program, inst.config), role: R },
    { address: await landlordPda(inst.program, inst.config, owner.address), role: W },
    { address: inst.dividendMint, role: R },
    { address: dividendAccount, role: R },
    { address: inst.coinMint, role: R },
    { address: coinAccount, role: R },
    { address: inst.dividendTokenProgram, role: R },
    { address: inst.coinTokenProgram, role: R },
    { address: SYSTEM_PROGRAM, role: R },
  ]);
}

export async function resyncBaselineIx(inst: Instance, owner: TransactionSigner, dividendAccount: Address) {
  return ix(inst.program, DISC.resyncBaseline, [
    signer(owner, false),
    { address: inst.config, role: R },
    { address: await landlordPda(inst.program, inst.config, owner.address), role: W },
    { address: dividendAccount, role: R },
  ]);
}

export async function deregisterLandlordIx(inst: Instance, owner: TransactionSigner) {
  return ix(inst.program, DISC.deregisterLandlord, [
    signer(owner, true),
    { address: inst.config, role: W },
    { address: await landlordPda(inst.program, inst.config, owner.address), role: W },
  ]);
}

/** A sweep also passes (read-only) what a buyback would trade through, so it fails closed when buybacks can't run. */
export async function sweepIx(
  inst: Instance,
  pool: Address,
  poolAccounts: PoolAccounts,
  landlord: Address,
  dividendAccount: Address,
) {
  const authority = await authorityPda(inst.program, inst.config);
  const dividendIndex = poolAccounts.mints[0] === inst.dividendMint ? 0 : 1;
  return ix(inst.program, DISC.sweep, [
    { address: inst.config, role: W },
    { address: authority, role: R },
    { address: landlord, role: W },
    { address: inst.dividendMint, role: R },
    { address: dividendAccount, role: W },
    { address: await ata(authority, inst.dividendMint, inst.dividendTokenProgram), role: W },
    { address: inst.coinMint, role: R },
    { address: await ata(authority, inst.coinMint, inst.coinTokenProgram), role: R },
    { address: pool, role: R },
    { address: poolAccounts.ammConfig, role: R },
    { address: poolAccounts.vaults[dividendIndex], role: R },
    { address: poolAccounts.vaults[1 - dividendIndex], role: R },
    { address: inst.dividendTokenProgram, role: R },
  ]);
}

/** Pool accounts the buyback needs, read from the Raydium CPMM pool state. */
export type PoolAccounts = {
  ammConfig: Address;
  vaults: [Address, Address];
  mints: [Address, Address];
  lpMint: Address;
  observation: Address;
};

/** Offsets match `PoolView::parse` in programs/endowment/src/raydium.rs. */
export function parsePool(bytes: Uint8Array): PoolAccounts {
  const at = (o: number) => getAddressDecoder().decode(bytes.slice(o, o + 32));
  return {
    ammConfig: at(8),
    vaults: [at(72), at(104)],
    mints: [at(168), at(200)],
    lpMint: at(136),
    observation: at(296),
  };
}

export async function buybackIx(
  inst: Instance,
  pool: Address,
  poolAccounts: PoolAccounts,
  caller: TransactionSigner,
  callerDividendAccount: Address,
  flagshipDividendVault: Address,
  /**
   * Only a donating endowment passes the flagship's vault writable (audit
   * R2-ISO-09), then the flagship's coin mint (R3-MINT-03) and config, whose
   * vault cap limits the donation (R3-MINT-01).
   */
  donates: boolean,
  flagshipConfigAddress: Address | null,
  minOut: bigint,
) {
  if (donates && !flagshipConfigAddress) throw new Error("A donating buy needs the flagship config");
  const authority = await authorityPda(inst.program, inst.config);
  const [cpmmAuthority] = await getProgramDerivedAddress({
    programAddress: CPMM_PROGRAM,
    seeds: [text.encode("vault_and_lp_mint_auth_seed")],
  });
  const dividendIndex = poolAccounts.mints[0] === inst.dividendMint ? 0 : 1;
  const coinIndex = 1 - dividendIndex;
  return ix(
    inst.program,
    DISC.buyback,
    [
      { address: inst.config, role: W },
      { address: authority, role: R },
      signer(caller, false),
      { address: callerDividendAccount, role: W },
      { address: inst.dividendMint, role: R },
      { address: inst.coinMint, role: R },
      { address: await ata(authority, inst.dividendMint, inst.dividendTokenProgram), role: W },
      { address: await ata(authority, inst.coinMint, inst.coinTokenProgram), role: W },
      { address: CPMM_PROGRAM, role: R },
      { address: cpmmAuthority, role: R },
      { address: poolAccounts.ammConfig, role: R },
      { address: pool, role: W },
      { address: poolAccounts.vaults[dividendIndex], role: W },
      { address: poolAccounts.vaults[coinIndex], role: W },
      { address: poolAccounts.observation, role: W },
      { address: poolAccounts.lpMint, role: W },
      { address: await ata(authority, poolAccounts.lpMint, LEGACY_TOKEN_PROGRAM), role: W },
      { address: flagshipDividendVault, role: donates ? W : R },
      { address: inst.dividendTokenProgram, role: R },
      { address: inst.coinTokenProgram, role: R },
      { address: LEGACY_TOKEN_PROGRAM, role: R },
      { address: TOKEN_2022_PROGRAM_ADDRESS, role: R },
      ...(donates && flagshipConfigAddress
        ? [
            { address: PROGRAM_FLAGSHIP_COIN_MINT, role: R },
            { address: flagshipConfigAddress, role: R },
          ]
        : []),
    ],
    getU64Encoder().encode(minOut) as Uint8Array,
  );
}

// ---- The daily commitment count: begin → count landlords in batches → finish ----

export type LandlordRow = { address: Address; record: LandlordRecord };

export function beginCountIx(inst: Instance) {
  return ix(inst.program, DISC.beginCount, [
    { address: inst.config, role: W },
    { address: inst.coinMint, role: R },
  ]);
}

/** Counts a batch of landlords: each as its record, coin account and dividend account. */
export function countLandlordsIx(inst: Instance, landlords: LandlordRow[]) {
  return ix(inst.program, DISC.countLandlords, [
    { address: inst.config, role: W },
    ...landlords.flatMap((l) => [
      { address: l.address, role: W },
      { address: l.record.coinAccount, role: R },
      { address: l.record.dividendAccount, role: R },
    ]),
  ]);
}

export function finishCountIx(inst: Instance) {
  return ix(inst.program, DISC.finishCount, [{ address: inst.config, role: W }]);
}

/**
 * Decrease-only re-read of landlords' balances. Signed by the endowment's
 * refresher, it also attests them: a landlord counts after REQUIRED_ATTESTATIONS
 * such reads, at least MIN_ATTEST_SPACING_SECS apart.
 */
export function refreshLandlordsIx(inst: Instance, caller: TransactionSigner, landlords: LandlordRow[]) {
  return ix(inst.program, DISC.refreshLandlords, [
    { address: inst.config, role: W },
    signer(caller, false),
    ...landlords.flatMap((l) => [
      { address: l.address, role: W },
      { address: l.record.coinAccount, role: R },
      { address: l.record.dividendAccount, role: R },
    ]),
  ]);
}

/** The refresher gives up its role at once (works after the admin renounces too). */
export function resignRefresherIx(inst: Instance, refresher: TransactionSigner) {
  return ix(inst.program, DISC.resignRefresher, [signer(refresher, false), { address: inst.config, role: W }]);
}

export async function pruneLandlordIx(inst: Instance, landlord: LandlordRow) {
  return ix(inst.program, DISC.pruneLandlord, [
    { address: inst.config, role: W },
    { address: await authorityPda(inst.program, inst.config), role: R },
    { address: landlord.address, role: W },
    { address: landlord.record.owner, role: W },
    { address: inst.coinMint, role: R },
    { address: landlord.record.dividendAccount, role: R },
    { address: landlord.record.coinAccount, role: R },
  ]);
}

/** Every landlord of one endowment (getProgramAccounts on the Landlord discriminator and config). */
export async function listLandlords(rpc: unknown, program: Address, config: Address): Promise<LandlordRow[]> {
  const discB58 = getBase58Decoder().decode(new Uint8Array(DISC.landlordAccount));
  type Row = { pubkey: Address; account: { data: [string, string] } };
  const rows = (await (rpc as { getProgramAccounts: (p: Address, c: unknown) => { send: () => Promise<Row[]> } })
    .getProgramAccounts(program, {
      encoding: "base64",
      filters: [
        { memcmp: { offset: BigInt(0), bytes: discB58, encoding: "base58" } },
        // Landlord.config sits right after the discriminator and version byte.
        { memcmp: { offset: BigInt(9), bytes: config, encoding: "base58" } },
      ],
    })
    .send()) as Row[];
  return rows
    .map((r) => ({ address: r.pubkey, record: decodeLandlord(base64ToBytes(r.account.data[0])) }))
    .filter((r): r is LandlordRow => r.record !== null);
}

/** Every endowment created on the program, via getProgramAccounts on the Config discriminator. */
export async function listConfigs(rpc: unknown, program: Address) {
  const discB58 = getBase58Decoder().decode(new Uint8Array(DISC.configAccount));
  type Row = { pubkey: Address; account: { data: [string, string] } };
  const rows = (await (rpc as { getProgramAccounts: (p: Address, c: unknown) => { send: () => Promise<Row[]> } })
    .getProgramAccounts(program, {
      encoding: "base64",
      filters: [{ memcmp: { offset: BigInt(0), bytes: discB58, encoding: "base58" } }],
    })
    .send()) as Row[];
  return rows
    .map((r) => ({ address: r.pubkey, config: decodeConfig(base64ToBytes(r.account.data[0])) }))
    .filter((r): r is { address: Address; config: EndowmentConfig } => r.config !== null);
}

export function bpsToPercent(bps: number) {
  return (bps / 100).toFixed(bps % 100 === 0 ? 0 : 1);
}
