# Collection pilot and incident runbook (not activated)

This source keeps `HOLD_COLLECTION_RELEASED = false`. Nothing here deploys, enables collection, sends an alert, or chooses launch numbers. Submission needs a separately reviewed release change, matching deployed v4 program/ABI, and the correct role key. The program's immutable public-launch flag must be set on chain before `--mode=public` will submit.

## Service setup

Run collector and reviewer under separate service identities, keys and durable directories, ideally separate hosts/providers. Do not share their journals or copy one role's payout archive to establish supposed independent evidence. Use Node 24, a fixed reviewed commit and a persistent supervisor; run one pass at a time, at an interval chosen from measured feed turnover, RPC cost and latency. A laptop that sleeps is not an always-on service. Back up journals, payout archives, configuration and incident records; never log keys or provider credentials.

Both roles need `SOLANA_RPC_URL`, `HOLD_DATA_DIR`, and reviewed program/creator environment settings. `HOLD_KEYPAIR_FILE` is read only when signing. Fund each operational signer for transactions and account rent and monitor its balance separately; no fee balance threshold or hosting scheduler is installed by this PR.

Collector submission requires an explicit mode:

- `npm run holding:once -- --role=collector --mode=founders --submit`: requires `HOLD_FOUNDERS_FILE`, an operator-controlled JSON array of reviewed wallet public keys. Only listed wallets may be collected from. Keep the list small, record its hash with the pilot plan, and give those holders the experimental consent disclosure. A changed list takes effect on service restart/next one-shot pass. The program's 0% test thresholds alone do not make enrollment private.
- `npm run holding:once -- --role=collector --mode=public --submit`: requires the on-chain public launch lock and exact 30%/25% thresholds, a 1.0× allowance and a positive daily rewards bound no greater than 10× the daily buy limit. Configuration is checked again immediately before signing and broadcast.
- `npm run holding:once -- --role=reviewer --submit`: reviews all discovered pending receipts and enrolled wallets, regardless of collector mode or the founders list. Never put recovery behind a founders allowlist.

The local allowlist and quarantine constrain this worker, **not a compromised collector key or someone running different software**. Do not describe them as on-chain fund limits. They complement the on-chain allowance, holding period, review requirement and pause.

## Make the read-only pilot substantive

Omit `--submit` to observe without signing. For the founders collector, keep `--mode=founders` and the same list. The current worker discovers enrolled consent records and outstanding receipts; it does **not** watch arbitrary addresses. Wallets must have the reviewed on-chain setup and active eligibility. Their first observation establishes a baseline. Inactive wallets and consent/count/day changes discard uncertain uncollected eligibility.

Inspect `health.json` each pass and retain `health.ndjson` as the run history:

- `owners.discovered`, `selected`, `processed`, `activeObserved`, and `historyRead` show whether the pass did real work. Zero wallets or zero history is not a pilot pass. `historyRead` means a history query completed, not that it found a payout; look at the observation counts as well.
- `observations` separates recognized rewards, outflows, ordinary/unmatched inflows and uncertain transactions. Missing reward records grant no credit; an ordinary/unmatched inflow is not necessarily a purchase. Archived record count does not prove that all distributions were captured. The finite 100-entry feed can overrun while a service is down, and cannot prove its own historical completeness.
- `amounts.proposedThisPass` is an overlapping dry-run candidate, **not** an amount collected; never sum it across ticks. Submitted amounts are not necessarily finalized. On-chain policy totals report pending, released, refunded and gross collected separately.
- The report always says `pilot.verdict = not_assessed`. A week of uptime does not automatically satisfy launch criteria.

Before even the small funded pilot, agree a maximum exposure, founders list, independent review/custody responsibilities and measurable acceptance criteria. Demonstrate actual collection, partial/full refund, holder reclaim, expiry, pause and explicit restart, missing feed/history, an unavailable reviewer, key rotation and recovery of a previously submitted transaction. Verify Stonk payouts to the actual treasury and match the deployed artifact to reviewed source. Manual criteria review is required; this implementation cannot certify readiness.

## Stops and alerts

`HOLD_STOP_FILE` selects the persistent collector stop path; default is `collection.stop` inside its data directory. An operator may create this file at any time. A collector feed failure, wallet error, history gap, uncertain history, or any pending receipt at least 30 hours old automatically creates it. The 30-hour threshold allows six hours after the minimum hold for settlement; it is a conservative local stop even if a chain pause or owner action explains the delay. It never disables refunds. Later successful passes do not remove it. No new collector transaction is signed/broadcast while it exists. An already broadcast transaction may still land: inspect persisted signatures and on-chain receipts before deciding the outcome.

For an incident:

1. Stop collection using the local control and, where warranted, the on-chain guardian pause. Keep reviewer/refund service and holder recovery available. Stop buybacks separately if the incident concerns treasury funds; do not assume stopping this collector stops other services.
2. Preserve the exact journals, feed archive, receipt identifiers, signatures and health reports. Reconcile pending submissions against finalized chain state. Never delete a journal to retry a collection.
3. Independently review affected receipts; keep uncertain amounts unspent and issue permitted refunds. After release, this receipt mechanism cannot return the released funds. Arrange any separate recovery explicitly.
4. Correct and test the cause. Record the incident and an explicit restart approval; remove the collector stop file only after that review. Clear the on-chain pause separately with the appropriate authority. A replacement host must preserve the existing stop state rather than starting with an empty directory.

An optional `HOLD_ALERT_WEBHOOK` accepts an operator-configured HTTPS POST endpoint. Do not configure it until authorized. The worker posts fixed issue codes and summary counts, never raw errors/provider URLs/credentials. Unchanged active issues repeat at most hourly; delivery failures retry with 30-second-to-1-hour backoff on later passes. Issue recovery sends one notification. Endpoint authentication may be in a secret query/path; it is never copied into payload or logs. This is a generic webhook, not a preconfigured Slack/email integration.

Alert issues include wallet/pass failures, feed failure, history gaps, uncertainty, collector quarantine, no selected wallets, receipts at least 30 hours old (collection stops), receipts at least 72 hours old (urgent recovery), and held amounts above the reviewer’s independently approved amount. That last alert means a refund is needed; missing evidence or conservative eligibility resets can cause it, so it does not by itself prove a mistaken collection. `health.json` is the completed-pass heartbeat, not a claim of successful transaction processing. Set up an **independent external monitor** to alert if either role's `finishedAt` is older than the agreed maximum interval, if no completed heartbeat appears, if exit codes fail, or if on-chain pending funds grow without settlement. A stopped process cannot send its own outage alert. Keep webhook failure/exit-code monitoring independent of that webhook. Infrastructure, destinations, polling intervals and paging ownership must be configured before launch.

The health history and journals grow without automatic pruning. Monitor disk space and preserve audit evidence when rotating service logs. An operator-controlled backup/retention policy is still required.
