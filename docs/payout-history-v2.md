# StonkFun v2 payout history migration (not activated)

The deployed v1 reader saw a `window_disjoint` gap on 2026-10-14 despite captures roughly every 30 seconds. The old platform-wide endpoint returns at most 100 grouped distribution records. StonkFun now marks it deprecated. The replacement is the **per-token** endpoint:

`GET https://www.stonkfun.xyz/api/v2/tokens/{mint}/rewards/payouts?limit=100&order=desc`

Sources checked 2026-10-14: [developer documentation](https://www.stonkfun.xyz/developers), [OpenAPI specification](https://www.stonkfun.xyz/api/public/v1/openapi.json). `rows` contains `{signature, holder, assetMint, amountRaw, amountTokens, createdAt}`; `page.nextCursor` is opaque. Follow the cursor with the same order, including after a short or empty page. Only `null` ends provider history; the optional explicit cold-start floor described below limits our traversal without claiming earlier coverage. These are holder payouts; fee-recipient payouts are separate. This source is still API evidence, not proof of a complete or truthful payout history.

## What the reader changes

- Requests the pinned PENIS mint's history, validates the schema and descending order, and follows cursors. Every previously archived head row must be re-observed before an incremental scan completes; an empty initial history must be scanned to its end (or its recorded cold-start floor) again. A disappearing head, altered existing holder row or conflict with a preserved legacy transaction total latches a gap.
- Deduplicates by signature, holder and asset mint. Conflicting duplicates fail closed. Only PUMP rows enter transaction totals; base-token payouts remain in continuity evidence but cannot add PUMP eligibility.
- Retains sums of stored holder rows per transaction for archive/migration integrity only. A floor boundary can contain only part of an older transaction; these sums are never whole-transaction proof and may grow when later pages add distinct holders. Previously stored rows remain immutable, duplicates cannot inflate sums, and totals must still match the archived rows without overflowing u64. Signing evidence is now a scoped index of individual PUMP holder rows. [Wallet-level verification](wallet-payout-verification.md) matches the pledged owner and its complete distributor gross, then credits only the reconciled net receipt. Other owners’ payouts need not belong to our coin; same-owner mixed-coin or split-account payouts remain conservatively excluded. Legacy aggregate totals cannot substitute for a missing holder row and remain subject to exact total matching.
- Keeps unfinished pagination in `payout-history-pending.json`. At most five pages are fetched per invocation, with a shared 20-second network budget and a 2 MB per-page body limit. A pass with more pages pending exits unsuccessfully and sends the existing failure heartbeat. It cannot publish partial totals or renew a completed archive's freshness.
- By default, a cold start traverses the available history to the end. Large histories can take many capture invocations. Once backfill completes, the archive retains the time of its **first** page, not the final page. If that time is stale, a fresh catch-up scan is required before the check can turn green.
- Requires a fresh HTTP `Date` and, when present, a valid fresh `Age` on the first page, because v2 has no `meta.generatedAt`. Cursor pages may be cached but must have a valid `Date` within the existing future-clock tolerance; they never renew archive freshness. A stale first-page CDN response, HTTP failure, missing/wrong JSON content type, HTML error page, truncated/malformed JSON, body size violation, or interrupted body read leaves accepted progress and freshness unchanged for retry at the same cursor. Once a JSON document has been read, invalid schema, conflicting rows, order/clock contradictions and cursor loops still latch `feed_invalid`. Transport recovery cannot clear an already latched gap. Older durable evidence is usable only until its ordinary 120-second freshness deadline.
- Makes complete archive/checkpoint writes atomic and durable, and handles a restart between archive publication and checkpoint removal. Cursor loops, invalid checkpoints and changed archive bindings fail closed. A process killed mid-pass may leave `feed.lock`; inspect the process and checkpoint before removing a stale lock.

The first traversal and stored holder rows can be substantially larger than the old grouped feed. Measure disk, memory, capture duration and API usage on each host before activation. The pass budget bounds network work, not the cost of parsing an indefinitely growing archive. This PR does not add automatic pruning; running out of resources must remain an alerting failure, never a truncated history accepted as complete.

Capture output now calls its count `archivedHolderRows`; worker health retains `feed.archivedRecords` for compatibility, but that count now means indexed PUMP holder rows, not transaction batches.

Only a validated, fresh, gap-free completed archive exports its first-page `fetchedAt` to the wallet verifier. That capture time can end a missing-row wait after a ten-minute margin over the finalized transfer time, without crediting the unmatched receipt. The verifier rechecks freshness and rejects future metadata at use. Partial checkpoints, synthetic empty fallbacks, API row timestamps and final-page completion time cannot satisfy this rule. Capture time is not a provider indexing watermark: a genuinely late or omitted API row can still lose eligibility. The six-hour durable batch cap remains the fallback; an actually expired recorded wait stays alertable even if capture has just recovered.

## Optional fresh-baseline history floor

`HOLD_HISTORY_FLOOR` accepts an explicit ISO timestamp, for example a conservatively verified pre-enrollment boundary. It is **unset by default**. Only set it after the fresh-baseline checks below; a timestamp alone cannot establish that old payouts are irrelevant. A program's latest upgrade time is not its first deployment time and is not automatically safe to use.

The floor is recorded in both the checkpoint and completed archive. It cannot be added to an existing archive or changed during resume/capture. Omitting the environment variable later retains the recorded floor. Initial use requires a fresh role directory (only the `role` marker may exist); journals, settlement outboxes, health files, old archives and stop files cause rejection. This file check does not replace the on-chain and other-host audit.

During a cold traversal, a fully validated descending page with a row strictly older than the floor ends the scan. The entire boundary page is retained, including rows at the cutoff. Partial passes remain unavailable, and first-page freshness still applies. Once a prior head exists, **all prior head rows must be found**, even below the floor; the cutoff never waives overlap or a latched gap. No stored rows are pruned. For example, the initial boundary page may retain eight of a transaction's seventeen holders. A later incremental scan may retain another boundary page containing the remaining nine. The derived sum can increase without a gap when every previously stored holder amount and timestamp is unchanged. Adding rows does not prove complete transaction coverage or rewind already processed wallet history.

API `createdAt` controls traversal only, never consent or eligibility. A backdated/omitted provider row can still cause a missed reward; the floor is not a completeness guarantee. Use the full-history default when a safe new baseline cannot be established. A fixed floor reduces initial backfill but does not bound future archive growth or rewrite cost.

## Migration and recovery

Keep collector/reviewer submission disabled while migrating. Follow the [verifier journal/outbox migration](wallet-payout-verification.md#migration) as well as the feed migration below. Stop the feed service before replacing code; install the reviewed commit and preserve all data, settings and keys. Keep the two hosts' archives independent.

The reader preserves the exact legacy file as `payout-feed.pre-v2.json` before publishing v2. Existing receipt totals are retained and cross-checked against v2, and a missing legacy payout blocks healthy migration. **Existing v1 gap flags carry forward.** Successful backfill does not silently clear `window_disjoint`, `capture_stalled`, `feed_invalid`, or a collector's `collection.stop` file. Unknown/corrupt legacy layouts fail rather than becoming an empty baseline.

The retained-row sum fix also preserves any existing v2 gap, including one latched by the former `Published payout total changed` check. Installing the fix alone does not recover a flagged archive. Preserve the incident and reconcile the original rows, added holders and finalized transfers before deciding on recovery. The fresh-baseline procedure below is available only when all its unused-installation checks pass.

For an unused initial installation, a **separate fresh v2 baseline** may be established only after both operators independently verify all of the following at a recorded finalized slot: no current or prior relevant enrollments, no collections, no outstanding receipts, and no unresolved signed/broadcast collector or settlement transactions on either host. Inspect on-chain consent/receipt accounts and policy counters as well as all journals and outboxes; absent current config/policy alone is insufficient historical proof. Keep submission disabled throughout.

Preserve the complete old role directory, stop flags, incident archive, logs and settings under a dated incident location with an inventory/checksums. Create a separate empty role directory and bind it to the same role. Do not hand-edit a gap to null or erase an outbox. Document the reason, verified boundary and operator decision. If any activity or unresolved evidence exists, use the preserving migration and reconcile first; do not use a fresh baseline. Complete and verify the new feed, compare representative chain payouts and retest alerts before a separately approved activation. This PR does not perform that migration or change either host's settings.

Never delete wallet journals or stop flags to make the dashboard green. If a cursor expires or a checkpoint is damaged, preserve it and the archive before reviewing a restart from the live head; do not promote its partial rows to completed evidence.

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

## Payout-age investigation after Brett's review

On October 14, approximately 10:11–10:13 p.m. Eastern (October 15 UTC), a fresh per-token response still listed [F7vN…7Rrz](https://explorer.solana.com/tx/F7vNvRPM4NHH6wr2npqkBoMfSeb2CRhR4V88Bxas1XbCYC4FgQ4zna3LLB81NSL3E5TsRzbxL547B8eLyLq7Rrz) as newest: API time October 13 21:48:15 UTC, finalized chain time 21:48:13 UTC. Finalized source-account signature history independently returned that same transaction as newest. This supports inactivity of the configured payout source, **not demonstrated API indexing lag**. It does not explain why payouts paused or prove the provider has not changed sources.

The fresh pending endpoint showed 35,715.294795 PUMP undistributed and 116.081253 PUMP in flight; the latter exactly matched the configured source's finalized token balance. Other launches had current global API payouts. At finalized slot 457066760 the configured endowment config/policy accounts were absent. ProgramData's latest deployment/upgrade slot 456669160 maps to October 14 02:15:35 UTC; it is not proof of the first deployment and no automatic cutoff was derived from it. These are point-in-time observations; recheck before migration. No production state was changed.
