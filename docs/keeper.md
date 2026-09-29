# Keeper runbook

The keeper triggers the endowment's permissionless instructions: sweeps, buybacks, the refresher's passes and the daily commitment count. Its key pays network fees and receives the buyback tip. It is also the flagship's **refresher**: a landlord counts only after three of its refresh reads, at least 30 minutes apart, since its last count. That key can't move funds, but it is trusted: whoever holds it chooses when landlords are read, so a leaked key could be used to time reads and count one holding in several wallets, or to leave landlords out. Treat it as sensitive (see Key custody), and keep it running: if it stops, nobody counts (see Health).

Routes: `/api/keeper/sweep`, `/api/keeper/buy`, `/api/keeper/count`, `/api/keeper/refresh`, `/api/keeper/prune`, `/api/keeper/health`. Code: `lib/keeper.ts`. Every job returns within about 50 seconds with whatever it managed, and resumes on its next call.

## Environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_ENDOWMENT_PROGRAM_ID` | The program ID. Must be in `KNOWN_PROGRAM_IDS` in `lib/endowment.ts`, or the site refuses it. |
| `NEXT_PUBLIC_ENDOWMENT_CREATOR` | The wallet that created the $PENIS endowment. Must equal `PROGRAM_FLAGSHIP_CREATOR` in `lib/endowment.ts`, which mirrors `FLAGSHIP_CREATOR` in the program; the site refuses any other value. |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | RPC for the browser and the public routes (`/api/ledger`, `/api/endowments`). Use a separate key from the keeper's. |
| `SOLANA_RPC_URL` | RPC for the keeper only (a paid provider such as Helius). Never used by public routes. |
| `KEEPER_SECRET_KEY` | The keeper wallet's 64-byte secret key, as a JSON array (`solana-keygen` format). **Production-only and marked Sensitive in Vercel.** Fund the wallet with about 1 SOL. |
| `CRON_SECRET` | Bearer token for scheduled GET calls. |
| `WEBHOOK_SECRET` | A different bearer token, for the dividend-drop webhook's POST calls. It can only trigger sweeps. |
| `KEEPER_JITTER_SECRET` | Optional. Seeds the random refresh draws (defaults to a hash input derived from the keeper key). |
| `KEEPER_PRIORITY_MICROLAMPORTS` | Optional. Priority fee per compute unit (default 5000). |
| `KEEPER_REFRESHES_PER_DAY` | Optional. About how many refresh passes run per day, at random times (default 8; a landlord needs three spaced passes between counts). |
| `KEEPER_REFRESH_TICK_MINUTES` | Optional. How often the refresh route is called by the scheduler (default 15). |

Set secrets with `vercel env add <NAME> production --sensitive`.

## Scheduling

Sub-daily Vercel Cron jobs need the Pro plan. Once the project is on Pro, add this to `vercel.json`:

```json
{
  "framework": "nextjs",
  "crons": [
    { "path": "/api/keeper/buy", "schedule": "*/5 * * * *" },
    { "path": "/api/keeper/sweep", "schedule": "*/15 * * * *" },
    { "path": "/api/keeper/count", "schedule": "*/15 * * * *" },
    { "path": "/api/keeper/refresh", "schedule": "*/15 * * * *" },
    { "path": "/api/keeper/prune", "schedule": "0 */6 * * *" }
  ]
}
```

Vercel sends `Authorization: Bearer $CRON_SECRET` automatically.

- **Buy:** every 5 minutes. Once the contract's minimum interval has passed and the vault holds the minimum buy, it simulates the buyback. If the contract would refuse (most often because the spot price is outside the endowment's price band around the TWAP), nothing is sent and the response logs the reason with the spot price, the TWAP and their deviation in basis points, so refusals can be reviewed later. Otherwise it sends the buy with `min_out` set to the simulated fill less 1%, on top of the contract's own TWAP floor. Frequent attempts matter: the price often sits outside the band for an hour or so, and a daily attempt would miss most windows.
- **Count:** attempted every 15 minutes. Once 24 hours have passed since the last round began, it runs a refresher pass (the contract only lets a round begin after one), begins a round, then counts. While a round is open, each call first re-reads the landlords it still expects that are short of their three reads (30 minutes after their last read), then sends every count batch (eight landlords each, shuffled) before confirming any, retries failed batches one landlord at a time, and finishes once all are counted or the four-hour timeout has passed. The contract leaves a landlord still short of reads pending rather than counting it as zero, so a round started early by someone else simply takes a little longer. It doesn't prune first: a landlord that no longer qualifies simply counts zero.
- **Refresh:** called every 15 minutes, but proceeds only on a secret-seeded random draw, about `KEEPER_REFRESHES_PER_DAY` times a day. Each pass reads every landlord in a fresh random order, in batches of eight, every batch sent before any is confirmed so they land within a slot or two of each other, and retries failed batches one landlord at a time. To count one holding in two wallets, someone would have to move it between the two wallets' batches in each of three independently shuffled passes.
- **Prune:** every 6 hours. Reads landlords in parallel and removes those that revoked or fell below the minimum stake.
- **Sweep:** every 15 minutes, as a fallback to the webhook.

Alternative without Vercel Pro: the GitHub Actions workflow in `docs/keeper-schedule.yml` does the same with `curl`. Copy it to `.github/workflows/` and add `KEEPER_URL` and `CRON_SECRET` as repository secrets. GitHub delays scheduled runs under load, so a paid scheduler is better for the refresh and count, and set `KEEPER_REFRESH_TICK_MINUTES` to the real cadence.

## Dividend-drop webhook

Create a Helius webhook on the dividend distributor's address (for $PENIS: `HuBMeYW3aDn8BH65fo8xxbP4oiexyup8udzKyccgi8Ga`) that POSTs to `/api/keeper/sweep` with the header `Authorization: Bearer $WEBHOOK_SECRET`. Sweeps then run within seconds of each drop.

## Count cost

There is no limit on landlords. Each count or refresh batch reads eight landlords (three accounts each) and fits a normal transaction, so no lookup table is needed. A count of N landlords takes about N/8 transactions, sent ten at a time.

## Runbook

- **Buys refused on price:** the buy response shows `skipped` (for example `PriceAboveTwap`, `PriceBelowTwap`, `FloorAboveQuote` or `TwapUnavailable`) and `price` (spot, TWAP, deviation and the band). Occasional refusals are expected on a volatile pool. If they last most of the day, consider proposing a wider `max_twap_deviation_bps` (bounded at 10%, timelocked 72 hours).
- **Health:** `GET /api/keeper/health` reports the round, the last count, the last refresher pass (`attestAgeSecs`), whether sweeps are on and the last sweep. `stale: true` if the last count is over 48 hours old, a round has been open past its timeout, or (with landlords) no refresher pass has landed in 12 hours. Point an uptime monitor at it: without refresher passes nobody counts, and sweeps switch off three days after the last count.
- **A count was run by someone else:** nothing to do. Counting is permissionless; the job continues any open round and otherwise reports "counted recently".
- **A landlord failed to count:** the response lists it with the error. The round still finishes after its timeout, without that landlord.
- **A sweep failed:** the response lists failing landlords with the error. Common causes: the landlord revoked, or the endowment is paused or not yet active. Other landlords are unaffected.
- **Buys skipped:** "below the minimum buy" or "not yet" are normal. Errors about fees, pool state or price mean the contract refused to trade in unsafe conditions. Check the pool and the mints' fee settings.
- **Keeper low on SOL:** top up the keeper wallet. Tips accrue as PUMP in its PUMP account and can be swapped to SOL as needed.

## Key custody

The keeper key signs every keeper transaction and is the flagship's refresher, so it is the one key whose misuse could change what the count finds (it can never move funds).

- **Founders' test (now):** the key lives only in `KEEPER_SECRET_KEY`, set as a **Production-only, Sensitive** environment variable in Vercel (`vercel env add KEEPER_SECRET_KEY production --sensitive`). It isn't available to preview or development deployments, and Sensitive values can't be read back from the dashboard or the CLI. Only the founders have access to the Vercel project. Keep the wallet's SOL balance small (about 1 SOL) and sweep accumulated tips out regularly.
- **Separate key for the refresher, later:** the refresher is a parameter, so it can be moved to its own key (for example a dedicated wallet run from a separate, locked-down scheduler) through the 72-hour timelock, leaving the Vercel key only for fee-paying cranks.
- **Rotation plan.** Rotate on any suspicion of exposure, when anyone with project access leaves, and otherwise every 90 days during the test:
  1. Generate a new keypair offline and fund it with a little SOL.
  2. The admin proposes the new key as `refresher` (72-hour timelock). Meanwhile the old key keeps running.
  3. When the change matures, apply it, replace `KEEPER_SECRET_KEY` in Vercel (Production, Sensitive) and redeploy.
  4. Move any remaining SOL and PUMP tips out of the old wallet.
  - **If the old key may be compromised,** don't wait for the timelock: sign `resign_refresher` with it right away. Nobody counts until the new refresher is applied, and sweeps switch off three days after the last count, which is the safe direction. After the admin role is renounced, resigning is the only change the refresher key can make, so a leaked key can always be shut off by the team, and never replaced by anyone.
