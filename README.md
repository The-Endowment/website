## Completion integration

This branch accompanies the contract change that permanently stops holder collection at the direct-vault goal. Deploy it only with that contract version. The goal uses the spendable coin balance in the derived endowment vault, including direct donations; cumulative purchases and liquidity holdings are separate. The website, enrollment check, keeper, and health endpoint share one lifecycle calculation. A pending direct donation can end collection before a transaction records the completion flag. The contract remains the authority for every transfer.

The campaign endpoint is a cached snapshot (up to five minutes between revalidations); enrollment rechecks the vault immediately before requesting approval, and each keeper pass reads it afresh. Existing treasury funds continue through the buy/liquidity policy. This change does not solve attribution of PENIS-derived PUMP or confirm that the live distributor will reward a program-owned treasury.

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
