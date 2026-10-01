## Completion integration

This branch accompanies the contract change that permanently stops holder collection at the direct-vault goal. The goal uses the spendable coin balance in the derived endowment vault, including direct donations; cumulative purchases and liquidity holdings are separate. Campaign, commitment, keeper health and daily snapshots share a lifecycle calculation. A pending direct donation can end collection before a transaction records the completion flag. The contract remains the authority for every transfer.

New enrollment and collection remain held closed pending independent review and an authorized release. The local version 4 replacement is implemented: a durable reporter tracks finalized StonkFun PUMP receipts and spending, then signs explicit, expiring collection instructions. The legacy balance-based sweep is disabled in the paired contract. Owner consent, restart/replay protections, lifecycle controls and the permanent 200M direct-vault goal are enforced. Existing revoke/leave stays available. See the [reporter runbook and trust limits](docs/reward-reporter.md).

There is **no per-wallet daily cap**. Purchased PUMP, existing balances, ordinary transfers and inactive-period rewards are excluded by the service's policy, but its classification is trusted: an error or compromised reporter can collect other PUMP. The wallet grants a broad, revocable PUMP allowance. The daily API comparison is an approximate operational check, not proof of individual collection accuracy. Unknown or missed receipts are left with holders. Retained program upgrade authority is a separate trust assumption.

`COLLECTION_RELEASED` stays false; there is no environment switch to reopen enrollment. `npm run reporter:once` is observation-only by default and requires reviewed deployment settings and durable storage. The old HTTP sweep job remains inert because the replacement runs in a persistent worker. This repository change does not deploy a contract, revoke old approvals, create a scheduler, or verify that the treasury is eligible for StonkFun rewards.

A [daily sanity check](docs/daily-sanity.md) compares StonkFun's reported distributions with the recorded holder-contribution counter using approximate participation. It saves daily observations on a persistent runner, flags large differences and missing data, and never initiates transfers. It is included for operator review; no live schedule is enabled.

Use Node.js 24 or later for the built-in TypeScript test runner:

```sh
npm ci --ignore-scripts
npm test
npm run lint
npx next typegen && npx tsc --noEmit
npm run build
```

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
