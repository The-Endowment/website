# Capped founder collection test — draft, blocked

This is the proposed first funded test of the current fixed-floor contract. It is not authorization to run the services. **Do not merge or deploy the accompanying release-flag change until the approval and settlement blockers below are resolved and both operators have reviewed the final procedure.** Existing journals, payout archives, consent and baselines must be preserved; no backfill or manual eligibility edits.

## Proposed scope

| Item | Proposed value |
| --- | --- |
| Holder | Roy only: `HpsRzXK3xWQxD1Px1KoExP5KYWs5gByEu47z6Ne6gDNf` |
| Asset | PUMP, mint `pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn`, six decimals |
| Maximum gross collected for the entire test | **1,000 PUMP = 1,000,000,000 raw units** |
| Maximum outstanding held amount | **1,000 PUMP = 1,000,000,000 raw units** |
| Owner's token approval | Exactly `1,000,000,000` raw units to the existing endowment delegate; no replenishment during this test |
| Source token account | `WnhwaPaZXDTQ9GXPiZ3NwWpXVtKff15kVCWR7Arhenw` |
| Endowment program | `HhJJRPcwABobT6jCEusieGuZxv6XvSKKvU32XyXASVF6` |
| Delegate | `HFRRErHwpCTDwnHEU1TDTeAK1gbA3pmkBqxBdhTyHyaf` |
| Contract mode | Existing fixed floor; tracked-mode PRs remain draft |
| Timing | A fresh, independently verified payout after the reviewed rollout; recent 20:20–20:50 UTC arrivals are observations, not a schedule |
| Collection | One collector pass, then return to observe mode and reconcile any persisted submission before another action |
| Settlement | After the receipt's on-chain 24-hour minimum hold, before its 72-hour expiry; agree the release/refund split in advance |
| Public launch and buybacks | Remain off; a passing small test alone does not start the public clock |

The founder list and a transaction's requested amount are local controls, not substitutes for the owner's on-chain token approval. Refunds do not refill a spent token allowance or the gross collection budget. If a pass collects less than the maximum, that does not authorize an automatic top-up or another pass.

## Blocker 1: the proposed 1,000 PUMP approval is not yet a runnable procedure

Two independent rules conflict with simply changing the approval and running the existing collector:

1. **Authorization changes clear observed eligibility.** `lib/reporter/classify.ts` treats an `approve` or `approveChecked` touching the holder's PUMP account as uncertain history, even with unchanged token balances and the same delegate. The collector clears that wallet's eligible rewards and raises `uncertain_history`, which quarantines collection globally. The independent reviewer also clears eligibility; ignoring the collector stop would not establish evidence for a positive release. Setting the approval immediately before collecting does not solve this.
2. **The legacy count/refresh requires a much larger delegation.** In reviewed contract main `6e1e5f5e6276ce30ece0f7b131af59135bace5ae`, `MIN_DELEGATION = u64::MAX / 2`. `read_landlord` uses that check for counting and refreshing. A refresh after the small approval clears `snapshot_valid`, the snapshot and attestations. The resulting reward allowance is zero. `sweep` itself caps collection by the actual remaining token allowance, but that does not bypass the count/refresh prerequisite.

See [the delegation threshold](https://github.com/The-Endowment/endowment/blob/6e1e5f5e6276ce30ece0f7b131af59135bace5ae/programs/endowment/src/constants.rs), [the shared count/refresh check](https://github.com/The-Endowment/endowment/blob/6e1e5f5e6276ce30ece0f7b131af59135bace5ae/programs/endowment/src/instructions/count.rs), and `tests/holding-funded-pilot.test.mts` for a local reproduction. These fixture tests exercise the worker; they are not a mainnet execution or a replacement for the contract checks.

Before this release can be ready, choose and test a reviewed way to retain the **hard 1,000 PUMP cap** while satisfying both independent history verification and the on-chain allowance rules. That must include an owner-signable approval transaction, verified from finalized chain state, and the behavior of any intervening refresh or daily count. A software-only collection limit, bypassing history checks, clearing a stop file without resolving its cause, or editing journals is not an equivalent solution. Do not ask the holder to restore unlimited approval to make this test proceed.

## Blocker 2: select the partial-refund method before collecting

The contract's `review_collection` records an approved portion once. After the hold, `settle_collection(release=true)` atomically sends that approved portion to the endowment and returns the remainder to the original holder's token account, then closes the receipt. A full release cannot be followed by a partial refund of the same receipt.

The current reviewer automatically approves the independently verified amount. If all 1,000 PUMP are valid rewards, it will approve all 1,000; the release flag adds no discretionary partial-refund option. Record the intended split and review a concrete way to submit a deliberately smaller authorization before enabling the submitting reviewer. It must never exceed the independently verified amount, falsify evidence, or edit the journal. A fully refundable receipt is not evidence that the partial-release path passed. Keep the reviewer observing until that procedure is ready.

See [review](https://github.com/The-Endowment/endowment/blob/6e1e5f5e6276ce30ece0f7b131af59135bace5ae/programs/endowment/src/collection/review.rs), [atomic settlement](https://github.com/The-Endowment/endowment/blob/6e1e5f5e6276ce30ece0f7b131af59135bace5ae/programs/endowment/src/collection/settlement.rs), and `lib/holding/worker.ts`.

## Readiness and execution record

Only after both blockers above are resolved:

1. Record the reviewed website and deployed contract revisions, both operators' agreement, the exact settlement split, fee/rent funding, and the independent monitoring/recovery responsibilities from [the pilot runbook](launch-pilot-runbook.md). Verify no previous submission or pending receipt is unresolved. Preserve all journals and archive state.
2. Keep both feed capture services and independent observation running. Install the reviewed worker revision without changing submit mode. Keep public enrollment, the public clock and buybacks off. Roy's refresher behavior during the capped-approval step must follow the reviewed solution to blocker 1, not an improvised timing workaround.
3. Compare the next payout's finalized transaction signature, chain time, raw amount and unspent eligible amount on both servers. An observation timestamp may differ. Confirm fresh complete archives, healthy reads and no quarantine. The currently verified eligibility normally clears at 00:00 UTC (08:00 Singapore); if the safe window is missed, wait for another payout rather than backfilling it.
4. Have Roy review and sign the agreed bounded-approval transaction in his wallet. Read back the canonical PUMP account, owner, mint, delegate and exact raw allowance. Recheck the current consent, fixed floor, on-chain reward allowance and both independent journals under the reviewed capped-approval procedure. Any mismatch stops the test before collection.
5. Brett runs one explicitly authorized collector pass with `--mode=founders --submit`, with only Roy's address in `HOLD_FOUNDERS_FILE`. Use the corresponding heartbeat mode. Immediately restore observe mode, including the heartbeat configuration. Inspect the persisted signature and finalized receipt; an ambiguous result requires recovery of that same submission, never an extra collection.
6. Record the amount actually held, source-wallet debit, remaining delegate allowance, receipt address, consent epoch, nonce, `release_at` and `refund_at`. Both servers independently reconcile the receipt to eligible rewards. A discrepancy means refund/recovery, not release. The hard cap must survive restart and must not be replenished.
7. At or after `release_at`, with fresh independent evidence and before `refund_at`, execute the reviewed release/refund procedure once. Record the settlement signature, the released and refunded amounts, the treasury and holder balance changes, receipt closure and aggregate pending/released/refunded totals. `released + refunded` must equal the original receipt amount. Observe the resulting protected baseline; a refund is not a new payout.
8. Return all collector/reviewer submission modes to observe, reconcile any outboxes, and document the result. Do not change the holder's token approval again without a separate explicit decision. Review the remaining launch/recovery criteria before deciding any further funded test or public-clock change.

This release candidate changes the source submission gate and the keeper status fields derived from it (`collectionWorkerReleased` and `sweepsOn`). Those fields are not evidence that a worker is running or submitting; check each host's configuration and completed-pass health. It does not change the program, token approvals, operating services, enrollment gate, public thresholds, consent, or existing account balances.
