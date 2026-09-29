import "server-only";
import {
  AccountRole,
  address,
  createClient,
  createKeyPairSignerFromBytes,
  getBase58Decoder,
  getProgramDerivedAddress,
  getU64Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { signer } from "@solana/kit-plugin-signer";
import {
  fetchMaybeToken,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { PENIS, PUMP_MINT } from "@/lib/solana";

// Raydium CPMM PENIS/PUMP pool (verified on-chain; also used by the contract's tests).
const CPMM_PROGRAM = address("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
const AMM_CONFIG = address("CRRS5ieQmBrZjWhcj99JuGrT5tyuWDaGAXLXLFjbAtjQ");
const POOL = address("AXTq4JHNYHSnooqjoDmtL9WW5eEgnkkMSWq76Kznidnz");
const POOL_PUMP_VAULT = address("HEmGXak4vSj9Dkikm3H82fQyhYUhzcZ7ub5TVuzYv9FC");
const POOL_PENIS_VAULT = address("D8h2adEhs9CR6Q5kRGEH3csGcsHxPDtpBwD1X4SbkugY");
const OBSERVATION = address("CijsijpVmMdKZdZLKnwbtDpcL6zE6o5smqfujExWRRGF");
const LP_MINT = address("3T9NWNMJunF7dpCNX4vzyAuJo9WBUtJ2RXSk846TKbNQ");
const LEGACY_TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

const DISC = {
  sweep: [40, 23, 234, 175, 14, 61, 154, 177],
  buyback: [106, 117, 64, 30, 56, 69, 7, 45],
  beginCount: [119, 0, 58, 85, 81, 17, 62, 91],
  countLandlords: [16, 55, 45, 27, 207, 59, 13, 48],
  finishCount: [226, 69, 229, 200, 228, 181, 186, 170],
  landlordAccount: [84, 167, 79, 195, 204, 84, 46, 152],
};

// Landlord account layout (after the 8-byte discriminator):
// owner 32 | pump_account 32 | baseline u64 | total_contributed u64 | registered_at i64 |
// last_sweep_at i64 | bump u8 | penis_account 32 | ...
const LANDLORD = { pumpAccount: 40, baseline: 72, penisAccount: 105 };

const text = new TextEncoder();
const W = AccountRole.WRITABLE;
const R = AccountRole.READONLY;

export type KeeperConfig = { program: Address; rpcUrl: string; secret: Uint8Array };

/** Everything the keeper needs, or null if launch settings aren't in place yet. */
export function keeperConfig(): KeeperConfig | null {
  const program = process.env.NEXT_PUBLIC_ENDOWMENT_PROGRAM_ID;
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const secret = process.env.KEEPER_SECRET_KEY; // JSON array of 64 bytes, as written by `solana-keygen`
  if (!program || !rpcUrl || !secret) return null;
  return { program: address(program), rpcUrl, secret: new Uint8Array(JSON.parse(secret)) };
}

async function keeperClient(cfg: KeeperConfig) {
  const keypair = await createKeyPairSignerFromBytes(cfg.secret);
  return createClient()
    .use(signer(keypair))
    .use(solanaRpc({ rpcUrl: cfg.rpcUrl, transactionConfig: { version: 0 } }));
}

async function pda(program: Address, ...seeds: (string | Uint8Array)[]) {
  const [p] = await getProgramDerivedAddress({
    programAddress: program,
    seeds: seeds.map((s) => (typeof s === "string" ? text.encode(s) : s)),
  });
  return p;
}

async function ata(owner: Address, mint: Address, tokenProgram: Address = TOKEN_2022_PROGRAM_ADDRESS) {
  const [a] = await findAssociatedTokenPda({ owner, mint, tokenProgram });
  return a;
}

function ix(program: Address, disc: number[], accounts: [Address, AccountRole][], args: Uint8Array = new Uint8Array()) {
  const data = new Uint8Array(disc.length + args.length);
  data.set(disc);
  data.set(args, disc.length);
  return {
    programAddress: program,
    accounts: accounts.map(([a, role]) => ({ address: a, role })),
    data,
  } as Instruction;
}

function u64At(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(offset, true);
}

function addressAt(bytes: Uint8Array, offset: number) {
  return address(getBase58Decoder().decode(bytes.slice(offset, offset + 32)));
}

type LandlordRow = { landlord: Address; pumpAccount: Address; penisAccount: Address; baseline: bigint };

async function listLandlords(client: Awaited<ReturnType<typeof keeperClient>>, program: Address): Promise<LandlordRow[]> {
  const discB58 = getBase58Decoder().decode(new Uint8Array(DISC.landlordAccount));
  const rows = (await client.rpc
    .getProgramAccounts(program, {
      encoding: "base64",
      filters: [{ memcmp: { offset: BigInt(0), bytes: discB58, encoding: "base58" } }],
    } as never)
    .send()) as unknown as { pubkey: Address; account: { data: [string, string] } }[];
  return rows.map(({ pubkey, account }) => {
    const bytes = Uint8Array.from(Buffer.from(account.data[0], "base64"));
    return {
      landlord: pubkey,
      pumpAccount: addressAt(bytes, LANDLORD.pumpAccount),
      penisAccount: addressAt(bytes, LANDLORD.penisAccount),
      baseline: u64At(bytes, LANDLORD.baseline),
    };
  });
}

/** Sweep every landlord whose PUMP account holds more than their baseline. */
export async function runSweeps(cfg: KeeperConfig) {
  const client = await keeperClient(cfg);
  const [config, authority] = [await pda(cfg.program, "config"), await pda(cfg.program, "authority")];
  const pumpVault = await ata(authority, PUMP_MINT);
  const penisVault = await ata(authority, PENIS);
  const authorityB = authority;

  const due: LandlordRow[] = [];
  for (const row of await listLandlords(client, cfg.program)) {
    const token = await fetchMaybeToken(client.rpc, row.pumpAccount);
    if (!token.exists || token.data.amount <= row.baseline) continue;
    const delegate = token.data.delegate;
    if (delegate.__option !== "Some" || delegate.value !== authorityB) continue;
    due.push(row);
  }

  const signatures: string[] = [];
  // A few sweeps fit in one transaction.
  for (let i = 0; i < due.length; i += 4) {
    const ixs = due.slice(i, i + 4).map((row) =>
      ix(cfg.program, DISC.sweep, [
        [config, W],
        [authority, R],
        [row.landlord, W],
        [PUMP_MINT, R],
        [row.pumpAccount, W],
        [pumpVault, W],
        [penisVault, R],
        [TOKEN_2022_PROGRAM_ADDRESS, R],
        [TOKEN_2022_PROGRAM_ADDRESS, R],
      ]),
    );
    const result = await client.sendTransaction(ixs);
    signatures.push(result.context.signature);
  }
  return { checked: due.length, signatures };
}

/**
 * Try one buyback. The contract sizes the buy, enforces the gap between buys and
 * the price floor, and pays this wallet a small PUMP tip on success.
 */
export async function runBuy(cfg: KeeperConfig) {
  const client = await keeperClient(cfg);
  const [config, authority] = [await pda(cfg.program, "config"), await pda(cfg.program, "authority")];
  const pumpVault = await ata(authority, PUMP_MINT);
  const vault = await fetchMaybeToken(client.rpc, pumpVault);
  if (!vault.exists || vault.data.amount === BigInt(0)) return { skipped: "no PUMP to spend" };

  const keeper = client.identity;
  const keeperPump = await ata(keeper.address, PUMP_MINT);
  const lpVault = await ata(authority, LP_MINT, LEGACY_TOKEN_PROGRAM);
  const [cpmmAuthority] = await getProgramDerivedAddress({
    programAddress: CPMM_PROGRAM,
    seeds: [text.encode("vault_and_lp_mint_auth_seed")],
  });

  const ixs = [
    getCreateAssociatedTokenIdempotentInstruction({
      payer: keeper,
      owner: keeper.address,
      mint: PUMP_MINT,
      ata: keeperPump,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    }),
    getCreateAssociatedTokenIdempotentInstruction({
      payer: keeper,
      owner: authority,
      mint: LP_MINT,
      ata: lpVault,
      tokenProgram: LEGACY_TOKEN_PROGRAM,
    }),
    ix(
      cfg.program,
      DISC.buyback,
      [
        [config, W],
        [authority, R],
        [keeper.address, AccountRole.READONLY_SIGNER],
        [keeperPump, W],
        [PUMP_MINT, R],
        [PENIS, R],
        [pumpVault, W],
        [await ata(authority, PENIS), W],
        [CPMM_PROGRAM, R],
        [cpmmAuthority, R],
        [AMM_CONFIG, R],
        [POOL, W],
        [POOL_PUMP_VAULT, W],
        [POOL_PENIS_VAULT, W],
        [OBSERVATION, W],
        [LP_MINT, W],
        [lpVault, W],
        [TOKEN_2022_PROGRAM_ADDRESS, R],
        [TOKEN_2022_PROGRAM_ADDRESS, R],
        [LEGACY_TOKEN_PROGRAM, R],
      ],
      getU64Encoder().encode(BigInt(0)) as Uint8Array, // min_out: the contract's own price floor protects the buy
    ),
  ];
  // Attach the keeper as the signer on the buyback's signer account.
  const buyback = ixs[2] as Instruction & { accounts: { address: Address; role: AccountRole; signer?: unknown }[] };
  buyback.accounts[2] = { ...buyback.accounts[2], signer: keeper };
  const result = await client.sendTransaction(ixs);
  return { signature: result.context.signature };
}

/** The daily on-chain count of committed landlords' $PENIS, which switches sweeps on or off. */
export async function runCount(cfg: KeeperConfig) {
  const client = await keeperClient(cfg);
  const config = await pda(cfg.program, "config");
  const rows = await listLandlords(client, cfg.program);
  const signatures: string[] = [];

  const begin = await client.sendTransaction([ix(cfg.program, DISC.beginCount, [[config, W]])]);
  signatures.push(begin.context.signature);
  for (let i = 0; i < rows.length; i += 12) {
    const count = ix(cfg.program, DISC.countLandlords, [
      [config, W],
      ...rows.slice(i, i + 12).flatMap((r) => [
        [r.landlord, W] as [Address, AccountRole],
        [r.penisAccount, R] as [Address, AccountRole],
      ]),
    ]);
    signatures.push((await client.sendTransaction([count])).context.signature);
  }
  const finish = await client.sendTransaction([
    ix(cfg.program, DISC.finishCount, [
      [config, W],
      [PENIS, R],
    ]),
  ]);
  signatures.push(finish.context.signature);
  return { landlords: rows.length, signatures };
}
