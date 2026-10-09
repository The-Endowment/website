# Independent refresher service (not configured)

Roy runs the reviewer and the refresher under separate keys; Brett runs the collector. The refresher observes balances and posts the daily cumulative reward total, which bounds collection. The reviewer independently checks each held contribution before release. Neither custody separation nor this automation means Roy manually signs every sweep: existing allowance can already authorize a collector debit, and review is the later release gate.

The website's fee-paying keeper cannot perform these refresher jobs. Do not put `REFRESHER_KEYPAIR_FILE`, its contents, or the reviewer key into the website deployment or the collector's host. Actual host account access, recovery access and backups must preserve the split too.

## Configuration

Use Node 24 and a fixed reviewed commit. This script uses the same keeper transaction builders, count batching, daily-post validation and refresh randomness as before; it does not implement a second rewards algorithm.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_ENDOWMENT_PROGRAM_ID`, `NEXT_PUBLIC_ENDOWMENT_CREATOR` | Reviewed, pinned instance settings, same as other services. |
| `SOLANA_RPC_URL` | Refresher RPC endpoint. |
| `REFRESHER_KEYPAIR_FILE` | Roy's private 64-byte JSON signer file, separate from reviewer and collector. |
| `REFRESHER_DATA_DIR` | Private persistent directory for the process lock and last completed `health.json`. |
| `REFRESHER_JITTER_SECRET` | Private random value used to draw refresh times. |
| `REFRESHER_HEARTBEAT_URL` | Optional Healthchecks-compatible HTTPS ping URL for this service alone; required in the agreed unattended operating setup. |
| `KEEPER_REFRESHES_PER_DAY` | Existing default: approximately eight randomly timed passes per day. |
| `KEEPER_REFRESH_TICK_MINUTES` | Actual scheduled cadence; default 15 minutes. |
| `KEEPER_PRIORITY_MICROLAMPORTS` | Existing priority fee default: 5000. |

First run `npm run refresher:once -- --check`. It reads state and verifies role separation; it does not submit transactions or send a success heartbeat. Initialization of collection must already have set the collector/reviewer addresses. Then schedule `npm run refresher:once -- --submit` every 15 minutes on Roy's host. **This submits attestations, count transactions and reward posts even during the collectors' read-only week.** It does not sweep or release holder funds.

Each pass checks the configured roles before each job, attempts refresh/count/post, writes a redacted report and sends one completed-pass heartbeat. A normal “not due” skip is healthy. Partial batch failures, wrong keys, feed errors, storage failures and unhealthy results exit nonzero and send a failure ping. A decreasing reward total requires operator investigation; it is not silently treated as a successful post. Do not manually reset the cumulative total without reviewing its consequences.

Run one pass at a time with a supervisor and a maximum runtime (for example five minutes). Use an external 15-minute expectation plus a suitable grace period (for example ten minutes); test the chosen values under load. Each worker needs its **own** external check. A hung or killed process cannot send its own failure, so alerting must happen outside the host. A stale lock after a crash is deliberately not removed automatically: verify the old process has stopped and check submitted transactions before removing it. Do not blindly rerun or duplicate an uncertain transaction.

## Bootstrap and pass criteria

Founders must sign registration, PUMP approval and collection consent through a reviewed private setup, while public enrollment stays closed. The refresher then needs at least three qualifying observations spaced at least 30 minutes apart; allow any necessary later count round for newly joined wallets. Both founders and public mode require a nonzero completed count at most three days old. An unfinished round does not extend that deadline. Following stale-count recovery, rewards from the inactive interval are not backfilled.

Before leaving funded collection unattended, stop each of the three services in turn and verify both founders actually receive the external missing-pass alert. Also test wrong signer, RPC failure, partial refresh/count failure and monitor delivery failure. A heartbeat proves a completed check, not successful payouts or overall launch readiness. Keep `/api/watch` as an independent chain-state check for overdue receipts, stale counts/posts and fee balances.

The public transition is separate: execute the 2-of-2 proposal, wait at least 72 hours, have Squads apply during the admin-only window, verify the irreversible public flag and 30%/25% parameters, then open enrollment. The first 24 hours after maturity are admin-only; an ordinary caller cannot apply until about 96 hours. Application resets founder count/allowance state. Fresh public participation must reach 30% before public collections start.
