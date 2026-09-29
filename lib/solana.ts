import { createSolanaRpc, type Address } from "@solana/kit";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import {
  flagshipConfig,
  PENIS_MINT,
  PROGRAM_ID,
  PUMP_MINT,
  type Instance,
} from "@/lib/endowment";

export { PENIS_MINT as PENIS, PUMP_MINT, PROGRAM_ID };

export const TOKEN_DECIMALS = 6;
export const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

/** A read-only RPC client for pages that don't need a wallet. */
export const readRpc = () => createSolanaRpc(RPC_URL);

/** The $PENIS endowment instance, or null before launch. Both mints are Token-2022. */
export async function flagshipInstance(): Promise<Instance | null> {
  const config = await flagshipConfig();
  if (!PROGRAM_ID || !config) return null;
  return {
    program: PROGRAM_ID,
    config,
    coinMint: PENIS_MINT as Address,
    dividendMint: PUMP_MINT as Address,
    coinTokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    dividendTokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  };
}

export function formatTokens(amount: bigint, decimals = TOKEN_DECIMALS): string {
  const whole = amount / BigInt(10) ** BigInt(decimals);
  return new Intl.NumberFormat("en-US").format(whole);
}
