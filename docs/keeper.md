# Keeper runbook

The keeper triggers the endowment's permissionless instructions: sweeps, buybacks, the refresher's passes and the daily commitment count. Its key pays network fees and receives the buyback tip. It is also the flagship's **refresher**: only landlords its refresh passes have read since their last count are counted. That key can't move funds or raise anyone's count; if it stops, nobody counts, so keep it running (see Health).

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
| `KEEPER_REFRESHES_PER_DAY` | Optional. About how many balance refreshes run per day, at random times (default 6). |
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

- **Buy:** runs every 5 minutes. It buys once the contract's minimum interval has passed and the vault holds the minimum buy. Anyone can call buyback, so the timing isn't hidden; the price protection is on-chain, and `min_out` is 0 because the contract's floor already sets the worst acceptable fill.
- **Count:** attempted every 15 minutes. Once 24 hours have passed since the last round began, it runs a refresher pass, begins a round, sends every count batch (eight landlords each, shuffled) at once, retries failed batches one landlord at a time, and finishes. If a round is already open, it counts whoever is left and finishes, after the two-hour timeout if some can't be counted. It doesn't prune first: a landlord that no longer qualifies simply counts zero.
- **Refresh:** called every 15 minutes, but proceeds only on a secret-seeded random draw, about `KEEPER_REFRESHES_PER_DAY` times a day. Each pass reads every landlord in shuffled batches of eight, all sent at once so they land in the same slot or two, and retries failed batches one landlord at a time. Signed by the refresher, it attests the landlords it reads. Coin moved between landlord wallets then counts at most once per refresh transaction someone could react between.
- **Prune:** every 6 hours. Reads landlords in parallel and removes those that revoked or fell below the minimum stake.
- **Sweep:** every 15 minutes, as a fallback to the webhook.

Alternative without Vercel Pro: the GitHub Actions workflow in `docs/keeper-schedule.yml` does the same with `curl`. Copy it to `.github/workflows/` and add `KEEPER_URL` and `CRON_SECRET` as repository secrets. GitHub delays scheduled runs under load, so a paid scheduler is better for the refresh and count, and set `KEEPER_REFRESH_TICK_MINUTES` to the real cadence.

## Dividend-drop webhook

Create a Helius webhook on the dividend distributor's address (for $PENIS: `HuBMeYW3aDn8BH65fo8xxbP4oiexyup8udzKyccgi8Ga`) that POSTs to `/api/keeper/sweep` with the header `Authorization: Bearer $WEBHOOK_SECRET`. Sweeps then run within seconds of each drop.

## Count cost

There is no limit on landlords. Each count or refresh batch reads eight landlords (three accounts each) and fits a normal transaction, so no lookup table is needed. A count of N landlords takes about N/8 transactions, sent ten at a time.

## Runbook

- **Health:** `GET /api/keeper/health` reports the round, the last count, the last refresher pass (`attestAgeSecs`), whether sweeps are on and the last sweep. `stale: true` if the last count is over 48 hours old, a round has been open past its timeout, or (with landlords) no refresher pass has landed in 12 hours. Point an uptime monitor at it: without refresher passes nobody counts, and sweeps switch off three days after the last count.
- **A count was run by someone else:** nothing to do. Counting is permissionless; the job continues any open round and otherwise reports "counted recently".
- **A landlord failed to count:** the response lists it with the error. The round still finishes after its timeout, without that landlord.
- **A sweep failed:** the response lists failing landlords with the error. Common causes: the landlord revoked, or the endowment is paused or not yet active. Other landlords are unaffected.
- **Buys skipped:** "below the minimum buy" or "not yet" are normal. Errors about fees, pool state or price mean the contract refused to trade in unsafe conditions. Check the pool and the mints' fee settings.
- **Keeper low on SOL:** top up the keeper wallet. Tips accrue as PUMP in its PUMP account and can be swapped to SOL as needed.
