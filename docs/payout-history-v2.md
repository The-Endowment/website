# StonkFun v2 payout history migration (not activated)

The deployed v1 reader saw a `window_disjoint` gap on 2026-10-14 despite captures roughly every 30 seconds. The old platform-wide endpoint returns at most 100 grouped distribution records. StonkFun now marks it deprecated. The replacement is the **per-token** endpoint:

`GET https://www.stonkfun.xyz/api/v2/tokens/{mint}/rewards/payouts?limit=100&order=desc`

Sources checked 2026-10-14: [developer documentation](https://www.stonkfun.xyz/developers), [OpenAPI specification](https://www.stonkfun.xyz/api/public/v1/openapi.json). `rows` contains `{signature, holder, assetMint, amountRaw, amountTokens, createdAt}`; `page.nextCursor` is opaque. Follow the cursor with the same order, including after a short or empty page. Only `null` ends history. These are holder payouts; fee-recipient payouts are separate. This source is still API evidence, not proof of a complete or truthful payout history.

## What the reader changes

- Requests the pinned PENIS mint's history, validates the schema and descending order, and follows cursors. Every previously archived head row must be re-observed before an incremental scan completes; an empty initial history must be scanned to its end again. A disappearing head, altered row or changed published transaction total latches a gap.
- Deduplicates by signature, holder and asset mint. Conflicting duplicates fail closed. Only PUMP rows enter transaction totals; base-token payouts remain in continuity evidence but cannot add PUMP eligibility.
- Retains exact transaction totals for archive/migration integrity only. Signing evidence is now a scoped index of individual PUMP holder rows. [Wallet-level verification](wallet-payout-verification.md) matches the pledged owner and its complete distributor gross, then credits only the reconciled net receipt. Other owners’ payouts need not belong to our coin; same-owner mixed-coin or split-account payouts remain conservatively excluded. Legacy aggregate totals cannot substitute for a missing holder row.
- Keeps unfinished pagination in `payout-history-pending.json`. At most five pages are fetched per invocation, with a shared 20-second network budget and a 2 MB per-page body limit. A pass with more pages pending exits unsuccessfully and sends the existing failure heartbeat. It cannot publish partial totals or renew a completed archive's freshness.
- A cold start traverses the available history to the end. Large histories can take many capture invocations. Once backfill completes, the archive retains the time of its **first** page, not the final page. If that time is stale, a fresh catch-up scan is required before the check can turn green.
- Requires a fresh HTTP `Date` and, when present, a valid fresh `Age`, because v2 has no `meta.generatedAt`. A stale CDN response or HTTP failure leaves progress and freshness unchanged for a retry. Contradictory or malformed data invalidates previously healthy evidence. Older durable evidence is usable only until its ordinary 120-second freshness deadline.
- Makes complete archive/checkpoint writes atomic and durable, and handles a restart between archive publication and checkpoint removal. Cursor loops, invalid checkpoints and changed archive bindings fail closed. A process killed mid-pass may leave `feed.lock`; inspect the process and checkpoint before removing a stale lock.

The first traversal and stored holder rows can be substantially larger than the old grouped feed. Measure disk, memory, capture duration and API usage on each host before activation. The pass budget bounds network work, not the cost of parsing an indefinitely growing archive. This PR does not add automatic pruning; running out of resources must remain an alerting failure, never a truncated history accepted as complete.

Capture output now calls its count `archivedHolderRows`; worker health retains `feed.archivedRecords` for compatibility, but that count now means indexed PUMP holder rows, not transaction batches.

## Migration and recovery

Keep collector/reviewer submission disabled while migrating. Follow the [verifier journal/outbox migration](wallet-payout-verification.md#migration) as well as the feed migration below. Stop the feed service before replacing code; install the reviewed commit and preserve all data, settings and keys. Keep the two hosts' archives independent.

The reader preserves the exact legacy file as `payout-feed.pre-v2.json` before publishing v2. Existing receipt totals are retained and cross-checked against v2, and a missing legacy payout blocks healthy migration. **Existing v1 gap flags carry forward.** Successful backfill does not silently clear `window_disjoint`, `capture_stalled`, `feed_invalid`, or a collector's `collection.stop` file. Unknown/corrupt legacy layouts fail rather than becoming an empty baseline.

For Roy's initial setup, preserve the original incident archive and logs, verify there are no outstanding held receipts or active collection, and agree any new baseline explicitly before clearing an old gap. With active receipts, reconcile their evidence, pending signatures and refunds first. Never delete wallet journals or stop flags to make the dashboard green. If a cursor expires or a checkpoint is damaged, preserve it and the archive before reviewing a restart from the live head; do not promote its partial rows to completed evidence.

The new reader supports **catching up after a normal outage** when every old head row can still be reached by pagination. During the outage/backfill, stale history blocks collection and release. A completed fresh catch-up can restore feed health, but an existing gap or collector stop still needs manual review. Missing rows, expired/unusable cursors or unavailable history are not recoverable merely by retrying faster.

No contract change, release-gate change, service enablement, key change or public-launch proposal is included. Before funded use, review the normalized totals against representative finalized transactions, finish both hosts' independent backfills, resolve any existing gaps, and test actual reviewer/refresher heartbeats and outage delivery to both operators.

## Read-only validation performed

On 2026-10-14, an isolated local directory fetched 15 live pages (1,500 holder rows) across three capture invocations. Pagination resumed without a gap and remained incomplete, correctly withholding a healthy archive. This was a schema/resume smoke test, **not a full production backfill**. A stale CDN response was also observed and rejected without renewing evidence freshness.

Three sampled finalized Solana transactions each had 17 PUMP transfers from `J8vxiGw4gPng3JTN9HoKJs3ioCD5fnjKGDtRHPVGgaGo`, under `HuBMeYW3aDn8BH65fo8xxbP4oiexyup8udzKyccgi8Ga`. Their summed v2 holder amounts exactly matched the parsed on-chain transfer totals:

| Transaction | Matching raw PUMP total |
|---|---:|
| [67LQ…S7xh2](https://explorer.solana.com/tx/67LQSxM3nntPBmcQXjtzJBMWHaGwBaTQZ4DT7cEJkZeZzXEsKPpuS4wHab3cea7LQuQXjq1BTunMqykArdjS7xh2) | 3186963993 |
| [5PMu…cBXD](https://explorer.solana.com/tx/5PMuMJvwSEQgXiUgYw7SJk8qsWkDwebip36yJoYe5aMX3Nw6JUqtDx3vctS3rjHnHGZgM6pg9AT8t9U2KQAYcBXD) | 4675324861 |
| [3Jjv…ijDe](https://explorer.solana.com/tx/3Jjv6qABXGiGWzCCws5toebMSahwHCtCbNRrT37poCn2MDmAB1NT3rkokeyXk9ydLZL5NVhZKfcWq5cHosrmijDe) | 2734428644 |

These samples support the adapter's amount semantics; they do not establish complete coverage or replace deployment/pilot acceptance tests. No private keys were used, no transactions were submitted, and the production archive and services were not migrated by this validation.

A separate sample of seven holder rows in [F7vN…7Rrz](https://explorer.solana.com/tx/F7vNvRPM4NHH6wr2npqkBoMfSeb2CRhR4V88Bxas1XbCYC4FgQ4zna3LLB81NSL3E5TsRzbxL547B8eLyLq7Rrz) was matched to finalized destination owners and exact checked-transfer gross amounts. The independent reviewer reran the new classifier against this saved public sample and all seven matched. A reduced public fixture preserves these checks without a network-dependent test.
