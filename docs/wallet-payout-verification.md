# Wallet-level payout verification

This extends the paginated reader in PR13. It changes server verification, not the contract. Deployment, signing and the public-launch clock remain separate operator decisions.

## Plan and independent review

The planning agent inspected the code, official StonkFun OpenAPI schema, and a finalized public transaction sample. A second agent independently reviewed the plan and sample. Both signed off before implementation. Review tightened two rules: stable pre/post ownership alone is insufficient when an account changes authority within a transaction, and an unsupported distributor authority must not be silently omitted from owner totals. Both rules are implemented and covered by adversarial tests.

The schema exposes a wallet owner, asset, exact gross amount and transaction signature per holder. It does not expose a transfer instruction index or prove exhaustive attribution across generating coins. In the sampled transaction, seven holder rows matched destination owners and checked-transfer amounts. API coin attribution remains a trust assumption: chain evidence proves payment, source, owner and amount, while the API identifies the generating coin.

## Acceptance rules

1. A complete, fresh, gap-free per-token archive supplies an exact `(signature, wallet owner, PUMP mint)` row scoped to our coin. Duplicate identities cannot add amounts, and conflicting rows fail. Old aggregate totals remain only for archive integrity, never eligibility. API timestamps do not replace finalized blockchain time for consent.
2. Inspect the finalized successful transaction and every PUMP transfer from the fixed distributor source. Require the reviewed authority to be a transaction signer. Checked transfers require explicit mint and decimals; unchecked transfers additionally require verified source/destination token identity.
3. Every distributor PUMP destination requires unambiguous account-index metadata, matching pre/post owner, mint, token program and decimals. Reject authority or lifecycle changes touching relevant accounts, even if an owner is changed and restored. New or closed destination accounts therefore conservatively block the candidate. Unparsed token instructions remain uncertain.
4. Sum the distributor's PUMP transfers to **all accounts owned by the pledged wallet**. That total must exactly equal the wallet's API amount, and all positive transfers must land in its pledged token account. All incoming PUMP to that account must come from the approved distributor; concurrent outflow is ambiguous.
5. Credit only the positive, reconciled net balance increase, bounded by verified gross. Transfer fees reduce eligibility. Never select an equal-sized subset, divide mixed payouts proportionally or credit the minimum of an API estimate and a balance change.

| Example | Result |
|---|---|
| Our coin pays Alice 100; another coin pays Bob 50 in the same transaction | Alice may qualify for her actual net receipt; no API row for Bob is needed |
| Our coin's Alice row says 100; Alice receives 150 combined rewards | No new reward credit |
| Alice's row says 100; two Alice-owned accounts each receive 100 | No new reward credit; cannot assign the row to the correct account |
| Alice's row says 100; verified gross is 100 and net receipt is 97 | Credit 97 |
| A destination changes owners or lacks stable metadata | Uncertain; no reward credit |

Positive observations record the verification version, generating coin, owner, transaction, asset, API gross, target account, verified owner gross, net credit and API timestamp in the journal's existing evidence hash chain.

## Accounting that remains necessary

The wallet history scan remains complete, including spending, purchases and refunds. Spending consumes eligible rewards first; buying replacement tokens or receiving refunds cannot restore eligibility. Pre-pledge balances, missing consent times, duplicate transactions, ambiguous same-slot order and discontinuous balances remain conservative boundaries. Existing allowance/capacity, consent, pause, freshness and pre-broadcast checks remain.

A recently finalized, otherwise valid distributor receipt with no exact holder row pauses that wallet's entire uncommitted batch for a bounded wait. The saved cursor stays in place, so later spending is replayed with the payout when evidence arrives. A durable batch deadline prevents repeated missing rows from extending the wait indefinitely. After expiry, missing rows add no eligibility; processed history is never rewound for retroactive credit. See [attribution retry rules](payout-attribution-retry.md). The archive's unchanged-total protection may reject later corrections. Independent collector and reviewer archives remain mandatory. This design improves attribution and avoids an unrelated wallet's transaction total blocking a reward; it does not solve API omissions or same-wallet mixed-coin allocation.

## Migration

Before activation, stop submission services, preserve journals/archives/stop flags, and reconcile already signed or broadcast transactions. Both roles' snapshot bindings include `stonk-holder-v1`. Existing journals remain readable and append a new zero-eligibility boundary; historical entries are not rewritten or deleted.

The collector checks its durable pending signature **before** resetting an old binding. A live pending authorization stays pending; resolved or expired migration recovery ends without new signing or replaying history for extra credit.

New reviewer decisions carry the verification version. Old/missing-version decisions become explicit zero/refund decisions on reset, with a new migration evidence hash; their original evidence remains in earlier journal entries. Settlement independently refuses positive clearance from the wrong version. Same-version decisions still survive routine daily boundaries.

Settlement outboxes are never renamed or erased. A previously signed clear stays pending until resolved or expired; recovery records the outcome and ends that tick without rebroadcasting old bytes or preparing a replacement. The next pass rereads current receipt and consent before any action. Code cannot revoke a transaction already broadcast; operators must reconcile it before rollout.

Preserve existing feed gaps and collector stop files. Complete both hosts' independent backfills, check resource use, review the existing incident and test alerts before enabling workers. No automatic gap reset, deployment, signing enablement, contract change or key renunciation is included.
