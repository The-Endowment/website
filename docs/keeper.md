# Keeper runbook

The web keeper now runs **permissionless buybacks and pruning only**. Roy's separate refresher service runs attestations, counts and reward-total posts; see [refresher.md](refresher.md). Collector and reviewer remain separate durable services; see [collection-worker.md](collection-worker.md). The website must never hold the reviewer or refresher key. Its fee-paying keeper key receives the existing buyback tip and is refused if it matches the configured refresher.

Routes: `/api/keeper/buy`, `/api/keeper/prune`, `/api/keeper/health`. `/api/keeper/count`, `/refresh` and `/post` return HTTP 410 so obsolete schedules fail visibly instead of silently losing attestations. The legacy `/sweep` route still does not collect. Code: `lib/keeper.ts` (server-only loading) and `lib/keeper-runtime.ts` (shared job logic).

## Environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_DELEGATION_OPEN` | `true` permits new pledges and re-enrollment. Unset, those actions are blocked; existing holders can still connect, stop collection, revoke approval and reclaim pending contributions for the configured instance. Keep it unset until the rollout is reviewed. |
| `NEXT_PUBLIC_ENDOWMENT_PROGRAM_ID` | The program ID. Must be in `KNOWN_PROGRAM_IDS` in `lib/endowment.ts`, or the site refuses it. |
| `NEXT_PUBLIC_ENDOWMENT_CREATOR` | The wallet that created the $PENIS endowment. Must equal `PROGRAM_FLAGSHIP_CREATOR` in `lib/endowment.ts`, which mirrors `FLAGSHIP_CREATOR` in the program; the site refuses any other value. |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | RPC for the browser and the public routes (`/api/ledger`, `/api/endowments`). Use a separate key from the keeper's. |
| `SOLANA_RPC_URL` | RPC for the keeper only (a paid provider such as Helius). Never used by public routes. |
| `KEEPER_SECRET_KEY` | The keeper wallet's 64-byte secret key, as a JSON array (`solana-keygen` format). **Production-only and marked Sensitive in Vercel.** Agree a small fee reserve and replenish it based on measured usage. |
| `CRON_SECRET` | Bearer token for scheduled GET calls. |
| `WEBHOOK_SECRET` | A different bearer token, for the dividend-drop webhook's POST calls. It can only trigger sweeps. |
| `KEEPER_PRIORITY_MICROLAMPORTS` | Optional. Priority fee per compute unit (default 5000). |

Set secrets with `vercel env add <NAME> production --sensitive`.

## Scheduling

Sub-daily Vercel Cron jobs need the Pro plan. Once the project is on Pro, add this to `vercel.json`:

```json
{
  "framework": "nextjs",
  "crons": [
    { "path": "/api/keeper/buy", "schedule": "*/5 * * * *" },
    { "path": "/api/keeper/prune", "schedule": "0 */6 * * *" }
  ]
}
```

Vercel sends `Authorization: Bearer $CRON_SECRET` automatically.

- **Buy:** every 5 minutes. Once the contract's minimum interval has passed and the vault holds the minimum buy, it simulates the buyback. If the contract would refuse (most often because the spot price is outside the endowment's price band around the TWAP), nothing is sent and the response logs the reason with the spot price, the TWAP and their deviation in basis points, so refusals can be reviewed later. Otherwise it sends the buy with `min_out` set to the simulated fill less 1%, on top of the contract's own TWAP floor. Frequent attempts matter: the price often sits outside the band for an hour or so, and a daily attempt would miss most windows.
- **Prune:** every 6 hours. Reads landlords in parallel and removes those that revoked or fell below the minimum stake.
- **Collection:** use the separate durable collector/reviewer services; the old sweep route does not collect.

Alternative without Vercel Pro: the GitHub Actions workflow in `docs/keeper-schedule.yml` does the same with `curl`. Copy it to `.github/workflows/` and add `KEEPER_URL` and `CRON_SECRET` as repository secrets. This schedules only the web keeper. The independent refresher uses its own supervisor/timer; it is not triggered through GitHub or the website.

## Counts and daily reward posts

These run on Roy's independently controlled host, with a dedicated refresher key. Follow [refresher.md](refresher.md) for setup, cadence, checks and monitoring. The shared implementations and on-chain limits are unchanged apart from requiring a fresh completed count in founders mode too. Do not keep old website count/refresh/post schedules enabled after this migration.

## Dividend-drop webhook

Do not point a webhook at `/api/keeper/sweep`; it no longer collects funds. A distributor webhook may wake the durable collector, but the worker still verifies finalized history and PENIS-specific feed records. Cadence, retry handling and independent reviewer scheduling must be configured and measured before launch.

## Count cost

There is no limit on landlords. Each count or refresh batch reads six landlords (four accounts each, including consent) and fits a normal transaction, so no lookup table is needed. A count of N landlords takes about ceil(N/6) transactions, sent ten at a time.

## Runbook

- **Buys refused on price:** the buy response shows `skipped` (for example `PriceAboveTwap`, `PriceBelowTwap`, `FloorAboveQuote` or `TwapUnavailable`) and `price` (spot, TWAP, deviation and the band). Occasional refusals are expected on a volatile pool. If they last most of the day, consider proposing a wider `max_twap_deviation_bps` (bounded at 10%, timelocked 72 hours).
- **Health:** `GET /api/keeper/health` reports the round, the last count, the last refresher pass (`attestAgeSecs`), whether collection is released in this build, whether sweeps are on and the last sweep. `stale: true` if the last count is over 48 hours old, a round has been open past its timeout, or (with landlords) no refresher pass has landed in 12 hours. This diagnostic endpoint returns JSON; a basic HTTP-status monitor alone is not enough. Use `/api/watch` for chain-health HTTP alerts and separate external completed-pass checks for all three workers. Without refresher passes nobody counts; sweeps switch off three days after the last completed count in every mode.
- **Independent watch:** `GET /api/watch?key=<WATCH_SECRET>` needs no signing key, so it keeps working when the keeper, collector or reviewer is down. It answers 200 when nothing needs attention and 503 with `issues` otherwise: `paused`; `receipt_overdue` (a collection held 30 hours, where the collector stops itself); `receipt_stuck` (72 hours: refunds aren't being submitted); `reward_post_stale` (36 hours) and `count_stale` (48 hours), both only while landlords are enrolled; `low_fee_balance` (collector, reviewer or refresher under 0.05 SOL); and `read_failed` when the chain can't be read. Missing launch configuration returns 503 `not_configured`; raw provider errors are not exposed. Set `WATCH_SECRET` (Production, Sensitive) and `SOLANA_RPC_URL` (listing pending collections needs `getProgramAccounts`, which public RPC nodes often refuse). Point an external uptime monitor at it every few minutes, alerting both founders on any non-200. Each collection worker's own `health.json` heartbeat needs a separate check-in monitor: this watch sees the chain, not whether a process is alive.
- **A count was run by someone else:** nothing to do. Counting is permissionless; the job continues any open round and otherwise reports "counted recently".
- **A landlord failed to count:** the response lists it with the error. The round still finishes after its timeout, without that landlord.
- **A sweep failed:** the response lists failing landlords with the error. Common causes: the landlord revoked, or the endowment is paused or not yet active. Other landlords are unaffected.
- **Buys skipped:** "below the minimum buy" or "not yet" are normal. Errors about fees, pool state or price mean the contract refused to trade in unsafe conditions. Check the pool and the mints' fee settings.
- **Keeper low on SOL:** top up the keeper wallet. Tips accrue as PUMP in its PUMP account and can be swapped to SOL as needed.

## Key custody and rotation

Use **2-of-2 Roy/Brett approval for admin and upgrades**, plus a separate **1-of-2 guardian** that either can use to pause. Both approvals are required for restart. Verify actual Squads vault addresses, membership, thresholds, and the absence of an independent configuration authority that could bypass the quorum. These scripts do not create or verify the multisigs for you.

Brett controls collector hosting and its key; Roy controls reviewer and refresher hosting with separate keys. The Vercel keeper is a fourth, unprivileged fee payer. Do not upload Roy's keys to Brett's server or a jointly administered website project. Admin signer backups are separate from always-on operational keys.

For refresher rotation, pause on suspected exposure; propose the replacement through admin, wait the timelock, apply, verify roles, and replace Roy's refresher key file. Expect fresh attestations/counts before collection resumes. Follow the same custody review for collector/reviewer rotation. No funds or signing keys are configured by this source change.

The buyback tip is PUMP paid to a successful buyback caller, not a general treasury expense withdrawal or a guaranteed offset to bills. Budget hosting and all signer fees explicitly. Account rent for pending contributions is temporary working capital until settlement, separate from transaction fees.
