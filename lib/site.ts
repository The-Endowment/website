export const PENIS_MINT = "JE3HT7SbCgXDQWV6xp3oiiAisDzq4HyZ8wyEVBDCs45Z";
export const MAIN_POOL = "AXTq4JHNYHSnooqjoDmtL9WW5eEgnkkMSWq76Kznidnz";

/** Delegation stays closed until the contract is live: set NEXT_PUBLIC_DELEGATION_OPEN=true to open it. */
export const DELEGATION_OPEN = process.env.NEXT_PUBLIC_DELEGATION_OPEN === "true";
export const DELEGATION_CLOSED_NOTE = "Pledging opens once the contract is deployed and checked.";

export const links = {
  x: "https://x.com/PenisEndowment",
  github: "https://github.com/The-Endowment/endowment",
  stonkfun: `https://www.stonkfun.xyz/token/${PENIS_MINT}`,
  dexscreener: `https://dexscreener.com/solana/${MAIN_POOL.toLowerCase()}`,
  solscan: `https://solscan.io/token/${PENIS_MINT}`,
};

/** The logo on its 25 x 15 grid: '#' = the columns, '.' = the building. */
export const LOGO_GRID = [
  "            .            ",
  "         .......         ",
  "      .............      ",
  "    .................    ",
  ".........................",
  "                         ",
  "   #     #     #     #   ",
  "  ###   ###   ###   ###  ",
  "  ###   ###   ###   ###  ",
  "  ###   ###   ###   ###  ",
  "  ###   ###   ###   ###  ",
  "  ###   ###   ###   ###  ",
  " ##### ##### ##### ##### ",
  " ## ## ## ## ## ## ## ## ",
  ".........................",
];
