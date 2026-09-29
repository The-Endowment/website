# Keeper runbook

The keeper triggers the endowment's permissionless instructions: sweeps, buybacks and the daily commitment count. It holds no special power; its key only pays network fees and receives the buyback tip. Anyone can run one.

Routes: `/api/keeper/sweep`, `/api/keeper/buy`, `/api/keeper/count`, `/api/keeper/health`. Code: `lib/keeper.ts`.

## Environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_ENDOWMENT_PROGRAM_ID` | The program ID. Must be in `KNOWN_PROGRAM_IDS` in `lib/endowment.ts`, or the site refuses it. |
| `NEXT_PUBLIC_ENDOWMENT_CREATOR` | The wallet that created the $PENIS endowment (part of its config address). |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | RPC for the browser (reads only). |
| `SOLANA_RPC_URL` | RPC for the keeper (a paid provider such as Helius). |
| `KEEPER_SECRET_KEY` | The keeper wallet's 64-byte secret key, as a JSON array (`solana-keygen` format). **Production-only and marked Sensitive in Vercel.** Fund the wallet with about 1 SOL. |
| `CRON_SECRET` | Bearer token for scheduled GET calls. |
| `WEBHOOK_SECRET` | A different bearer token, for the dividend-drop webhook's POST calls. It can only trigger sweeps. |
| `KEEPER_JITTER_SECRET` | Optional. Seeds the randomized buy timing (defaults to a hash input derived from the keeper key). |
| `KEEPER_BUY_JITTER_SECS` | Optional. Random delay added after the contract's minimum buy interval (default 1200). |
| `KEEPER_PRIORITY_MICROLAMPORTS` | Optional. Priority fee per compute unit (default 5000). |
| `KEEPER_LOOKUP_TABLE` | Optional. The count's address lookup table. If unset, the keeper finds or creates one it owns. |

Set secrets with `vercel env add <NAME> production --sensitive`.

## Scheduling

Sub-daily Vercel Cron jobs need the Pro plan. Once the project is on Pro, add this to `vercel.json`:

```json
{
  "framework": "nextjs",
  "crons": [
    { "path": "/api/keeper/buy", "schedule": "*/5 * * * *" },
    { "path": "/api/keeper/sweep", "schedule": "*/15 * * * *" },
    { "path": "/api/keeper/count", "schedule": "0 * * * *" }
  ]
}
```

Vercel sends `Authorization: Bearer $CRON_SECRET` automatically.

- **Buy:** runs every 5 minutes. The job only buys once the vault holds the minimum buy and a randomized time after the last buy has passed, so buys land at irregular times.
- **Count:** attempted hourly. It runs as soon as 24 hours have passed since the last count, so a strict 24-hour interval never drifts behind a fixed daily schedule.
- **Sweep:** every 15 minutes, as a fallback to the webhook.

Alternative without Vercel Pro: the GitHub Actions workflow in `docs/keeper-schedule.yml` does the same with `curl`. Copy it to `.github/workflows/` and add `KEEPER_URL` and `CRON_SECRET` as repository secrets.

## Dividend-drop webhook

Create a Helius webhook on the dividend distributor's address (for $PENIS: `HuBMeYW3aDn8BH65fo8xxbP4oiexyup8udzKyccgi8Ga`) that POSTs to `/api/keeper/sweep` with the header `Authorization: Bearer $WEBHOOK_SECRET`. Sweeps then run within seconds of each drop.

## Address lookup table

The commitment count reads every landlord in one transaction: up to 28 landlords, two accounts each. That only fits under Solana's transaction size limit with an address lookup table. The count job handles this itself: it finds or creates a table owned by the keeper wallet, extends it with any missing roster accounts, waits a slot, and sends the count as a version 0 transaction using the table. After the first run, set `KEEPER_LOOKUP_TABLE` to the table address it reports, to skip the lookup.

## Runbook

- **Health:** `GET /api/keeper/health` reports the age of the last count and `stale: true` if it is over 48 hours. Point an uptime monitor at it.
- **A count was run by someone else:** nothing to do. The count is atomic and permissionless; the job reports "counted recently".
- **A sweep failed:** the response lists failing landlords with the error. Common causes: the landlord revoked, or the endowment is paused or not yet active. Other landlords are unaffected.
- **Buys skipped:** "below the minimum buy" or "not yet" are normal. Errors about fees, pool state or price mean the contract refused to trade in unsafe conditions. Check the pool and the mints' fee settings.
- **Keeper low on SOL:** top up the keeper wallet. Tips accrue as PUMP in its PUMP account and can be swapped to SOL as needed.
