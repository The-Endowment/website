import { fetchMaybeMint } from "@solana-program/token-2022";
import { flagshipConfig, listConfigs, PROGRAM_ID } from "@/lib/endowment";
import { readRpc } from "@/lib/solana";

export const dynamic = "force-dynamic";

export type EndowmentSummary = {
  config: string;
  coinMint: string;
  name: string | null;
  symbol: string | null;
  committedBps: number;
  active: boolean;
  coinBought: string;
  landlords: number | null;
  flagship: boolean;
};

const CACHE = "public, s-maxage=300, stale-while-revalidate=600";

/** Every endowment on the contract, cached at the edge for five minutes. */
export async function GET() {
  if (!PROGRAM_ID) return Response.json({ endowments: [] }, { headers: { "Cache-Control": CACHE } });
  const rpc = readRpc();
  try {
    const flagship = await flagshipConfig();
    const configs = await listConfigs(rpc, PROGRAM_ID);
    const endowments: EndowmentSummary[] = await Promise.all(
      configs.map(async ({ address, config }) => {
        let name: string | null = null;
        let symbol: string | null = null;
        try {
          const mint = await fetchMaybeMint(rpc, config.coinMint);
          if (mint.exists && mint.data.extensions.__option === "Some") {
            const meta = mint.data.extensions.value.find((e) => e.__kind === "TokenMetadata");
            if (meta && meta.__kind === "TokenMetadata") {
              name = meta.name;
              symbol = meta.symbol;
            }
          }
        } catch {
          // Metadata is optional; the mint address is shown instead.
        }
        return {
          config: address,
          coinMint: config.coinMint,
          name,
          symbol,
          committedBps: config.lastCountBps,
          active: config.active,
          coinBought: config.totalCoinBought.toString(),
          landlords: null,
          flagship: address === flagship,
        };
      }),
    );
    endowments.sort((a, b) => Number(b.flagship) - Number(a.flagship));
    return Response.json({ endowments }, { headers: { "Cache-Control": CACHE } });
  } catch {
    return Response.json({ endowments: [] }, { headers: { "Cache-Control": "public, s-maxage=60" } });
  }
}
