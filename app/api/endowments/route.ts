import { fetchMaybeMint } from "@solana-program/token-2022";
import { DEFAULT_ADDRESS, flagshipConfig, listConfigs, PENIS_MINT, PROGRAM_ID } from "@/lib/endowment";
import { readRpc } from "@/lib/solana";

// Built once and regenerated at most every five minutes; the query string can't bypass it.
export const dynamic = "force-static";
export const revalidate = 300;

/** At most this many endowments are listed (the largest by coin bought), so spam can't swamp the page. */
const MAX_LISTED = 50;

export type EndowmentSummary = {
  config: string;
  coinMint: string;
  name: string | null;
  symbol: string | null;
  committedBps: number;
  activateBps: number;
  active: boolean;
  coinBought: string;
  landlords: number;
  donationBps: number;
  flagship: boolean;
  /** An endowment for the $PENIS coin that isn't the $PENIS Endowment. */
  flagshipLookalike: boolean;
  /** Trust signals (audit KW-08, R2-ROLES-09): what its keys can still do. */
  renounced: boolean;
  guardian: boolean;
  refresherIsCreator: boolean;
  noRefresher: boolean;
  pendingChange: boolean;
  retired: boolean;
  /** The spot-to-average price band buys run within, in basis points. */
  priceBandBps: number;
  /**
   * Third-party mint authorities that could pause buybacks (never move funds):
   * a transfer-fee authority that could raise a fee above the cap, or a
   * transfer-hook authority that could set a hook (audit R3-MINT-02).
   */
  mintAuthorities: string[];
};

type MintExtension = { __kind: string; [key: string]: unknown };
/** An unset authority is stored as the all-zero address. */
const isSet = (v: unknown) => typeof v === "string" && v !== DEFAULT_ADDRESS;

/** Which live third-party authorities a mint carries (fee or hook), by name. */
function authoritiesOf(extensions: MintExtension[], label: string) {
  const out: string[] = [];
  for (const e of extensions) {
    if (e.__kind === "TransferFeeConfig" && isSet(e.transferFeeConfigAuthority)) out.push(`${label} fee authority`);
    if (e.__kind === "TransferHook" && isSet(e.authority)) out.push(`${label} hook authority`);
  }
  return out;
}

/** Every endowment on the contract, with what its admin, guardian and refresher can still do. */
export async function GET() {
  if (!PROGRAM_ID) return Response.json({ endowments: [] });
  const rpc = readRpc();
  try {
    const flagship = await flagshipConfig();
    const configs = (await listConfigs(rpc, PROGRAM_ID))
      .sort((a, b) =>
        a.address === flagship ? -1 : b.address === flagship ? 1 : Number(b.config.totalCoinBought - a.config.totalCoinBought),
      )
      .slice(0, MAX_LISTED);
    const endowments: EndowmentSummary[] = await Promise.all(
      configs.map(async ({ address, config }) => {
        let name: string | null = null;
        let symbol: string | null = null;
        const mintAuthorities: string[] = [];
        try {
          const [mint, dividend] = await Promise.all([
            fetchMaybeMint(rpc, config.coinMint),
            fetchMaybeMint(rpc, config.dividendMint),
          ]);
          if (mint.exists && mint.data.extensions.__option === "Some") {
            const meta = mint.data.extensions.value.find((e) => e.__kind === "TokenMetadata");
            if (meta && meta.__kind === "TokenMetadata") {
              name = meta.name;
              symbol = meta.symbol;
            }
            mintAuthorities.push(...authoritiesOf(mint.data.extensions.value as MintExtension[], "coin"));
          }
          if (dividend.exists && dividend.data.extensions.__option === "Some") {
            mintAuthorities.push(...authoritiesOf(dividend.data.extensions.value as MintExtension[], "dividend"));
          }
        } catch {
          // Metadata is optional; the mint address is shown instead.
        }
        const isFlagship = address === flagship;
        return {
          config: address,
          coinMint: config.coinMint,
          name,
          symbol,
          committedBps: config.lastCountBps,
          activateBps: config.params.activateBps,
          active: config.active,
          coinBought: config.totalCoinBought.toString(),
          landlords: config.landlordCount,
          donationBps: config.donationBps,
          flagship: isFlagship,
          flagshipLookalike: !isFlagship && config.coinMint === PENIS_MINT,
          renounced: config.admin === DEFAULT_ADDRESS,
          guardian: config.guardian !== DEFAULT_ADDRESS,
          refresherIsCreator: config.params.refresher === config.creator,
          noRefresher: config.params.refresher === DEFAULT_ADDRESS,
          pendingChange: config.pendingEffectiveAt > BigInt(0) || config.retireAt > BigInt(0),
          retired: config.retired,
          priceBandBps: config.params.maxTwapDeviationBps,
          mintAuthorities,
        };
      }),
    );
    return Response.json({ endowments });
  } catch {
    return Response.json({ endowments: [], error: "couldn't read the list right now" });
  }
}
