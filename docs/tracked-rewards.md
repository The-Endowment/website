# Tracked rewards proposal

Draft companion to the endowment contract's `enable_tracked_collection` and `authorize_collection` instructions. Nothing is deployed by this change. The existing `HOLD_COLLECTION_RELEASED=false` gate stays in place.

## Accounting and consent

The original on-chain PUMP floor blocks collections after holders spend their starting balance. The existing journal already tracks verified unspent rewards: finalized PENIS payout records add eligibility; every outflow consumes eligible rewards first; purchases, ordinary transfers and refunds add none. This proposal uses that accounting without imposing the original floor on holders who explicitly choose the new mode.

The current balance and the complete transaction cursor are reconciled before each decision. The balance after a collection starts the next interval; intermediate buys, spends and payouts are replayed rather than inferred from net changes. A fresh/missing journal or a new consent starts with zero eligibility. No previous payouts are backfilled.

The contract does not verify payout history itself. The reviewer and collector independently replay it, and the reviewer signs a bounded, temporary on-chain permit before the collector can collect. Shared code/provider errors or compromise of both roles can still cause incorrect collection. The post-collection review and refund window remain necessary, including for a spend/rebuy after both services checked the same balance.

`NEXT_PUBLIC_TRACKED_REWARDS_OPEN` defaults off. Enable it only after review, contract deployment and both worker updates. It then offers existing legacy holders a separate unchecked consent to switch, and selects tracked mode for new enrollment. Switching atomically resyncs and enables tracked consent with the holder's signature; no PUMP/PENIS moves. It advances the consent epoch, makes old pending receipts refund-only and requires fresh count/eligibility checks. It does not silently change existing enrollments. Previously tracked holders keep their mode when rejoining. Stop, Revoke, Leave and reclaim do not depend on this flag.

## Server workflow

1. Reviewer replays its own finalized wallet journal and payout archive. It computes the eligible amount within balance, posted allowance and capacity.
2. It checks current consent, history cursor and balance again. With explicit authorization enabled, it signs `authorize_collection` for that exact balance, next nonce and amount, with a ten-minute expiry. The contract also binds current roles, count, refresher epoch and pause timestamp.
3. Collector independently replays history and caps its request by its own unspent rewards and the valid permit. It still checks the latest transaction cursor before signing a request valid for 45 seconds. Without a usable permit it continues observing and retains eligible rewards within the existing observation boundary.
4. A successful sweep moves funds only into the existing refundable holding account and consumes the nonce. Partial collections require a new permit for any remainder. The reviewer must still replay the actual sweep before permitting release; its earlier permit is not release approval.

The ten-minute permit supports the installed five-minute worker timers, including offset schedules. A changing balance or count requires a fresh permit. Frequent activity can postpone collection; it does not justify loosening reconciliation. The reviewer pays a small additional transaction fee per authorization and rent once per permit account; the holder does not sign each collection.

Reviewer `--submit` alone retains its existing recovery behavior. New grants require the separate `--authorize` flag plus an explicit `--mode=founders` or `--mode=public`. In founders mode it uses `HOLD_FOUNDERS_FILE` for authorization; refunds still process for all relevant wallets. Authorization rechecks the local stop file, health and feed before signing and broadcast. No installed timers or flags are modified by this PR.

Removing `--authorize` stops new grants; an existing on-chain permit can remain valid until its deadline. Stop the collector as well when halting operations. On-chain owner Stop/Revoke or a guardian pause prevents using an outstanding permit immediately.

Unsigned proposal amounts are exposed in the reviewer's `authorization` result; only `submitted` means a transaction was sent, not finalized. Existing collector/reviewer health and histories still need comparison before a funded test.

## Recovery and evidence

Each permit has a separate fsynced outbox under `permits/`. Exact signed bytes are saved before broadcast. After a timeout, the worker waits for finality or blockhash expiry before another authorization; it never blindly resends. Resolving that outcome remains read-only if signing is disabled. The wallet journal remains independent and intact.

Missing payout evidence blocks positive grants. Unknown transaction history cannot create a permit. Purchases, returned transfers and refunds are replayed but never credited as rewards. Existing shared feed/RPC failures and uncertain-history handling remain in place. Pre-funding an uninitialized permit PDA with SOL is treated as an absent permit, not an observation failure.

Day/count/consent/refresher/reviewer changes still discard unswept eligibility under the existing boundary rules. This proposal does not solve daily carry-forward or add RPC retries. Those are separate changes; do not interpret this PR as permission to clear quarantine, rebuild journals or reset balances.

## Validation and rollout boundaries

- Run the contract build and full LiteSVM suite; sync/check `schema.json` and `accounts.ts` from that exact IDL.
- `holding-client.test.mts` checks instruction bytes, account privileges and the permit PDA against `tests/fixtures/tracked-collection.json`, emitted by real Rust execution.
- `holding-tracked.test.mts` exercises two independent journals, below-floor rewards, purchases/refunds, spent rewards, same-balance races, stale permits, missing history/feed, outbox recovery and the separate authorization gate. Its RPC bank models transfers; Rust tests validate actual on-chain execution.
- Run all Node tests, TypeScript, lint and the production build. Test the explicit opt-in and recovery paths on an isolated program before turning on the flag.

Do not deploy, migrate live holders, change the current two servers, enable sweeps/releases or start the public clock as part of this draft. The funded test remains a separate coordinated step after review.
