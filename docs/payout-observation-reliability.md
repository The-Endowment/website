# Delayed payout evidence across daily and count boundaries

## Daily and count boundaries

The normal policy is unchanged: a new UTC day or count discards verified, uncollected eligibility. Logs now say “New UTC day or count: uncollected eligibility cleared, no tokens moved.”

A batch that was already waiting for payout attribution is the narrow exception. Each journal records all missing receipt signatures found in that finalized batch, its original cursor, deadline and first-wait time. On a day/count change, verified eligibility is cleared but those exact receipt identities and the old cursor survive. The worker rereads and reconciles the entire history before assigning any eligibility. Previously waiting rewards can become eligible after evidence arrives; purchases, ordinary transfers and refunds cannot. Spending consumes eligible rewards first, including spending while the evidence was delayed. Replaying a completed batch does not credit it twice.

Other rewards from before the new day/count are excluded, even if they were held in the same uncommitted batch. New rewards must have a finalized timestamp strictly after the latest boundary; same-second ordering is excluded conservatively unless the receipt was already waiting. Another rollover does not extend the original six-hour evidence deadline or reset its operational age. Expired attribution remains visible in health reporting.

Continuity requires unchanged consent, configuration identity, verifier, refresher epoch, collector, reviewer and pause state. Inactive collection or any changed scope cannot carry eligibility. If the reviewer observes an incident during an attribution wait, a durable flag prevents a later rollover from carrying that batch even if the previous settings return. Pending signed collection bytes still reconcile through the existing outbox before any new action. The reviewer retains completed receipt decisions; incomplete evidence cannot authorize clearance, and owner/chain-driven refunds remain available.

The first post-update pass learns boundary metadata from the existing journal without resetting its balance or cursor. Journals without enough saved continuity evidence reset conservatively if they encounter a boundary immediately. Receipts that were never observed waiting before a boundary are not backfilled, and this cannot recover payouts already skipped by an older worker. Do not delete or rewrite journals to manufacture eligibility.

The first selective carry writes journal version 2. This worker reads both versions; older workers reject a journal containing version 2 rather than replaying its retained cursor without the new filter and reviving discarded rewards. Do not downgrade a server once it has such a record. Reverting code requires an explicit operator-reviewed recovery plan with collection stopped, never removal of journal entries.

## Rollout

This worker update uses the existing contract and does not enable tracked mode, collection submission, release or the public clock. Deploy the same reviewed worker version to both servers with their journals intact, preserve existing operational stop files, and compare their observations. It is independent of the site-only reset notice and the separately reviewed tracked-mode upgrade.
