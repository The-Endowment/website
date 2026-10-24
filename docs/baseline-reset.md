# Owner-approved fixed-balance reset

This is a UI path for the current deployed contract, independent of the tracked-rewards proposal. It does not upgrade the program, change the servers or submit a wallet transaction by itself.

An enrolled legacy holder whose PUMP balance is below the protected starting balance can review a separate, unchecked consent to reset it. The app rereads enrollment, balance, approval and consent immediately before building the request. Changed amounts, epoch, mode or approval require a fresh review.

The public enrollment switch does not block this reset for an existing active pledge. New enrollment and re-enrollment stay closed; stopped consent, revoked approval, tracked mode, pauses and the other chain eligibility checks still prevent resetting. The live page and the request both apply these checks.

One owner-signed transaction contains the existing `resync_baseline` followed by `enable_collection`. There is no token approval, token transfer or tracked-mode instruction. The contract uses the balance at execution, clears the old reward allowance and starts a new consent epoch. All tokens currently held start protected, with no backfill. Existing pending receipts become refund-only. Fresh count/eligibility checks are required before later rewards can be collected.

The reset is a manual option, not automatic accounting. A holder who later spends below the new floor may need to reset again. It remains subject to existing enrollment/pause/goal checks; Stop, Revoke and reclaim remain independently usable.

For the founder test, review and merge this UI change separately, have the holder review and sign the reset, allow the normal refresher/observers to establish the new boundary, and compare new payout observations. Sweep and release remain off until the separately approved funded test. Do not reconstruct old eligibility, change journals or enable tracked mode as part of the reset.
