## Completion integration

This branch accompanies the contract change that permanently stops holder collection at the direct-vault goal. The goal uses the spendable coin balance in the derived endowment vault, including direct donations; cumulative purchases and liquidity holdings are separate. Campaign, commitment, keeper health and daily snapshots share a lifecycle calculation. A pending direct donation can end collection before a transaction records the completion flag. The contract remains the authority for every transfer.

New enrollment and automated collection are closed pending a reviewed replacement for the legacy sweep. The website no longer builds PUMP approvals, registration, baseline resets or sweep instructions; authenticated sweep jobs return `routing_pending` before loading the keeper key. There is no environment switch to reopen them. Existing revoke/leave remains available, and existing treasury funds retain their buy/liquidity path.

This is an application safeguard, not an on-chain fix: old approvals remain valid until owners revoke them, and another caller can still invoke the legacy contract. The campaign endpoint remains a cached snapshot. The owner has now accepted a trusted reporting service for receipt classification and bounded, wallet-specific collections; custom StonkFun payout routing is no longer a prerequisite. The contract's `docs/reward-routing-v1.md` describes this replacement and its trust limits. The reporter, contract authorization path and new consent/limits interface still need implementation and validation before enrollment reopens. Do not claim unconditional purchased-PUMP protection under a model that trusts the reporter. Program-owned treasury reward eligibility remains unverified.

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
