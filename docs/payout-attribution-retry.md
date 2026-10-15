# Delayed holder-row attribution

A finalized distributor transfer can appear on Solana before StonkFun publishes its holder row. When the transfer passes the source, authority, owner, account, asset, balance and net-receipt checks but its exact holder row is absent, workers report `awaiting_payout`. A conflicting row or ambiguous transfer does not qualify for this retry.

A missing row can be excluded earlier, without adding eligibility, when the completed, gap-free archive is fresh and its recorded fetch time is at least ten minutes after the finalized payout time. A partial pagination checkpoint, stale archive, wrong scope or API publication timestamp cannot provide this signal. This is a practical publication grace period, not proof that the API is complete. An already-expired stored batch deadline still reports expiry rather than hiding it behind a newly refreshed archive.

The first unresolved receipt establishes a durable deadline of its finalized `blockTime` plus six hours. The wallet journal records that deadline without advancing its history cursor, balance or eligibility. Later missing payouts cannot extend the same batch's deadline, including across process restarts. API `createdAt` timestamps cannot extend it. Transfers before consent do not wait for attribution.

While any receipt still requires a wait, the entire wallet history batch remains uncommitted. Later spending, repurchases and collection transactions stay in the replay. If the row arrives in time, the worker processes the complete sequence and credits only the remaining verified rewards. There is no partial cursor advance or API-only balance calculation. No new collection or positive clearance is signed while this wallet awaits attribution.

At the fixed batch deadline, all currently scanned missing rows are conservatively treated as ordinary receipts with no new eligibility, even if some arrived on-chain more recently. Correct holder rows already present still undergo normal verification. Successful complete replay clears the deadline; a later history batch can establish its own bound. This prevents frequent unrelated distributor payouts from indefinitely blocking the wallet's history.

Existing consent, epoch, daily or policy binding changes still establish conservative observation boundaries and discard unswept eligibility. They do not carry old eligibility forward merely to finish an API wait. Unknown or invalid timestamps cannot start a retry. Missing or expired evidence is not recovered by rewinding an already committed cursor.

Pending collector signatures are reconciled before observation retry. Reviewers retain their existing decisions and wallet cursor while waiting, block new positive clearance, and continue chain-driven refunds and pending settlement-outbox reconciliation. Already signed transactions are never blindly resent. A complete reviewer history replay still independently verifies any positive receipt decision.

A brief wait appears in health-report notes and continues sending a healthy heartbeat when the rest of the pass is healthy. The worker separately saves when it first began waiting, so an old payout does not immediately trigger an overdue alert. That first-wait time survives restarts and never extends the chain-based deadline. Existing journals with only a deadline initialize the operational start once on their first retry under this version; earlier unknown wait duration is not invented.

An unresolved wait lasting more than one hour raises `payout_evidence_overdue`. Expiry raises `payout_evidence_expired`, including on the pass that completes replay and clears the wait metadata. Exclusion after the completed-archive ten-minute grace period is an ordinary note, not an expiry alarm. Missing or malformed wait telemetry fails health rather than silently looking brief. Stale or gapped feeds, incomplete wallet passes, RPC failures and other existing issues still send failure heartbeats.

The wait does not itself erase an archive gap, clear a collector stop flag, or authorize deployment/signing. The retry improves availability for delayed publication; it does not prove API completeness or truthfulness.
