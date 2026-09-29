import {
  AccountRole,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { PENIS_MINT } from "@/lib/site";

export const PUMP_MINT = address("pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn");
export const PENIS = address(PENIS_MINT);
export const TOKEN_DECIMALS = 6;
export const U64_MAX = BigInt("18446744073709551615");

export const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

/** Unset until the endowment contract is deployed. */
const programId = process.env.NEXT_PUBLIC_ENDOWMENT_PROGRAM_ID;
export const PROGRAM_ID: Address | null = programId ? address(programId) : null;

const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
const REGISTER_LANDLORD_DISCRIMINATOR = new Uint8Array([51, 29, 33, 2, 132, 202, 221, 40]);

const text = new TextEncoder();

export async function authorityPda(program: Address) {
  const [pda] = await getProgramDerivedAddress({ programAddress: program, seeds: [text.encode("authority")] });
  return pda;
}

export async function configPda(program: Address) {
  const [pda] = await getProgramDerivedAddress({ programAddress: program, seeds: [text.encode("config")] });
  return pda;
}

export async function landlordPda(program: Address, owner: Address) {
  const [pda] = await getProgramDerivedAddress({
    programAddress: program,
    seeds: [text.encode("landlord"), getAddressEncoder().encode(owner)],
  });
  return pda;
}

/** The endowment's `register_landlord` instruction. Sent together with the PUMP `Approve`. */
export async function registerLandlordInstruction(
  program: Address,
  owner: TransactionSigner,
  pumpAccount: Address,
  penisAccount: Address,
): Promise<Instruction> {
  return {
    programAddress: program,
    accounts: [
      { address: owner.address, role: AccountRole.WRITABLE_SIGNER, signer: owner },
      { address: await configPda(program), role: AccountRole.WRITABLE },
      { address: await authorityPda(program), role: AccountRole.READONLY },
      { address: await landlordPda(program, owner.address), role: AccountRole.WRITABLE },
      { address: PUMP_MINT, role: AccountRole.READONLY },
      { address: pumpAccount, role: AccountRole.READONLY },
      { address: PENIS, role: AccountRole.READONLY },
      { address: penisAccount, role: AccountRole.READONLY },
      { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ],
    data: REGISTER_LANDLORD_DISCRIMINATOR,
  } as Instruction;
}

export function formatTokens(amount: bigint): string {
  const whole = amount / BigInt(10) ** BigInt(TOKEN_DECIMALS);
  return new Intl.NumberFormat("en-US").format(whole);
}
