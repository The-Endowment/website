# Founder collection test with software limits — pending joint review

This proposes one funded test of the current fixed-floor contract. Both operators must review the release PR and agree the scope, amounts and timing before deployment or submission. Keep sweep and release off until then. Preserve the existing journals, payout archives, consent and baselines; no backfill or manual eligibility edits.

## Scope and exposure

| Item | Proposed value |
| --- | --- |
| Holder | Roy only: `HpsRzXK3xWQxD1Px1KoExP5KYWs5gByEu47z6Ne6gDNf` |
| Asset | PUMP, mint `pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn`, six decimals |
| Software collection cap | **1,000 PUMP = 1,000,000,000 raw units**, pinned to one owner, consent epoch and collection nonce |
| Software approval cap | **600 PUMP = 600,000,000 raw units** for the agreed receipt; proposed example, confirm before submitting |
| Token approval | Leave the existing approval unchanged |
| Source token account | `WnhwaPaZXDTQ9GXPiZ3NwWpXVtKff15kVCWR7Arhenw` |
| Endowment program | `HhJJRPcwABobT6jCEusieGuZxv6XvSKKvU32XyXASVF6` |
| Delegate | `HFRRErHwpCTDwnHEU1TDTeAK1gbA3pmkBqxBdhTyHyaf` |
| Mode | Existing fixed floor; tracked mode and public launch remain separate |
| Timing | A fresh, independently verified payout after the reviewed rollout; recent 20:20–20:50 UTC arrivals are observations, not a schedule |
| Collection | One explicitly authorized pass, then return to observe mode |
| Settlement | At or after the receipt's 24-hour hold, before its 72-hour expiry |
| Public launch and buybacks | Remain off; this small test alone does not start the public clock |

**1,000 PUMP is not an on-chain or worst-case loss limit.** It bounds new requests made by this worker with the pinned controls and existing data directory. Other software, a compromised signing key, different directories, deletion of the control or previously signed transactions are outside that limit. The existing contract also bounds collection by balance above the fixed floor, token allowance, reward allowance and capacity, and requires held receipts and independent review before release. Those protections do not turn this local limit into an on-chain 1,000 PUMP cap. Both founders must accept that distinction before the test.

Reducing the SPL token approval is deliberately not part of this test. An approve/approveChecked currently clears observed eligibility and quarantines collection. The legacy refresh/count also requires MIN_DELEGATION = u64::MAX / 2, so a small approval invalidates the earning snapshot. The reproduction tests in tests/holding-funded-pilot.test.mts document why the original bounded-approval plan is not used. No parser, refresh, consent or contract checks are bypassed by the new options.

## One-time collector limit

Read the finalized consent account and record its current epoch and next_nonce as PILOT_CONSENT_EPOCH and PILOT_NONCE. Do not copy an old value or silently advance to a new nonce after a failed attempt. Set HOLD_FOUNDERS_FILE to an operator-controlled JSON array containing only Roy's address. Use the existing collector data directory and independent archive.

Preview without signing:

```sh
npm run holding:once -- --role=collector --mode=founders \
  --pilot-owner=HpsRzXK3xWQxD1Px1KoExP5KYWs5gByEu47z6Ne6gDNf \
  --pilot-consent-epoch="$PILOT_CONSENT_EPOCH" \
  --pilot-nonce="$PILOT_NONCE" \
  --collection-cap-raw=1000000000
```

After the fresh payout comparison and joint go-ahead, run the same command once with --submit and matching heartbeat mode, then restore observe mode. The amount is the minimum of independently tracked unspent rewards, ordinary chain limits and this cap. It may be less than 1,000 or zero. The cap is applied before the evidence hash and signed collection request are built; the reward ledger retains the full verified eligibility.

The nonce is consumed by the contract, so this scope cannot produce a second successful collection even after a restart or refund. A changed consent epoch, different owner or later nonce gives zero collection allowance under this pilot. A zero-value on-chain collection may also consume the nonce; do not automatically authorize a replacement. Observe and reconcile the existing signature before any decision about another test.

## Partial release and refund

Record the finalized receipt address as PILOT_RECEIPT. Roy's independent reviewer continues observing the original history and keeps its full verified decision and evidence hash. Set the limit for that exact receipt:

```sh
npm run holding:once -- --role=reviewer \
  --pilot-receipt="$PILOT_RECEIPT" \
  --approval-cap-raw=600000000
```

This preview does not sign. Once settlement is eligible, it prints plannedApprovalRaw and plannedRefundRaw in raw units; these are a proposed split, not confirmed transfers. Only after the hold has elapsed, the evidence remains fresh and both operators agree, run the same command once with --submit and the corresponding heartbeat mode. Return to observe mode afterward.

The signed approval is min(independently verified amount, approval cap). If 1,000 PUMP was collected and verified, the example approves 600; the same transaction releases 600 to the endowment and refunds 400 to Roy. If only 400 is verified, at most 400 is approved and 600 refunded. A zero cap or zero verified amount produces a full refund. No new reward credit is created and no independent decision or evidence hash is overwritten.

Already-reviewed receipts cannot have their on-chain review rewritten. If an earlier approval exceeds this cap, the worker chooses a full refund. A smaller valid approval remains smaller. Other receipts' positive releases wait while this pilot is pinned; their zero-evidence, incident, expiry and other legitimate refunds still follow the ordinary recovery rules. Existing hold, expiry, consent, incident, verification-version and feed checks all remain in force.

Release and partial refund are **atomic settlement of the same receipt**. A full release cannot be followed by a partial refund of that closed receipt. Refunds neither replenish the test collection budget nor create new eligible rewards.

## Restart and recovery controls

The first submitting pass writes founder-test.json into that role's durable HOLD_DATA_DIR under worker.lock, before any signing. It contains only public scope and raw limits. This is separate from the wallet and settlement journals. Preview alone creates no pilot control, but honors one already present.

- Later runs load the pinned control even if CLI flags are omitted. Changed amounts, roles, contract identities, owners, epochs or nonces are rejected. Malformed/truncated controls stop startup; they never silently fall back to uncapped submission.
- Collector submission still requires founders mode and exactly the pinned owner in its allowlist. It cannot switch to public collection merely by omitting the pilot flags.
- Signed bytes and uncertain outcomes still use the existing durable outboxes. An interrupted or expired transaction is reconciled before another action is prepared. Any new preparation continues to use the pinned cap.
- Limits apply to newly prepared actions, not to transactions signed earlier. Before pinning the test, verify there are no unresolved previously signed transactions or unrelated pending funded actions.
- Keep the control in place after the test. Do not delete it to retry, change data directories, top up the budget or move to the next nonce. Retiring it is a separate operator action after stopping submission, reconciling all outboxes/receipts and explicitly agreeing a subsequent rollout. Keep an audit copy.

## Execution evidence and acceptance

1. Record both reviewed revisions, the exact epoch/nonce, founder-file contents, proposed caps, agreed release/refund split and both operators' go-ahead. Confirm fees/rent funding, independent alerts and recovery responsibilities from [the pilot runbook](launch-pilot-runbook.md). Do not enable public enrollment, the public clock or buybacks.
2. Keep both independent feed captures, observations and the refresher running. Compare the next payout's finalized signature, chain time, raw amount and unspent eligibility on both servers. Observation timestamps may differ. Confirm fresh archives, healthy reads, current on-chain allowance and no stop file. Eligibility normally clears at 00:00 UTC (08:00 Singapore); if the window is missed, wait for another payout rather than backfilling.
3. Execute the agreed collector command once. Record its persisted signature, finalized source debit, receipt address, consent epoch/nonce, release_at, refund_at and amount held. Confirm actual collection is at most the cap. Restore observe mode. An ambiguous outcome is a recovery task, not permission to collect again.
4. Have the reviewer independently reconcile the collection to eligible rewards, then preview and execute the agreed capped settlement after the hold. Retain the independent decision alongside the operator cap. A mismatch or failed check blocks release and may require a full refund.
5. Verify the settlement signature, treasury/holder balance changes, receipt closure and aggregate pending/released/refunded counters. Released plus refunded must equal the receipt amount. Confirm a refund increases the protected floor and is never recognized as a new payout. Restore observe mode and reconcile any remaining outboxes.
6. Record results and the remaining launch/recovery scenarios. Do not start the public clock or assume public readiness from this small test alone.

The release flag also updates keeper fields collectionWorkerReleased and sweepsOn. Those are not proof that a worker is running or submitting; inspect each host's command and completed-pass health. This PR does not deploy the contract, alter token approvals, start timers, or move funds.
