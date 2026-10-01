# Refundable holder collections: review and operating guide

This is an unlaunched draft paired with [endowment PR #4](https://github.com/The-Endowment/endowment/pull/4).
That contract extends Brett's `allowance-v1` (endowment PR #3). This website
branch extends website PR #1 (`codex/reward-reporter`). The older endowment PR
#2 is an alternative architecture; do not merge both contracts without resolving
their different account layouts and instructions. This is not a migration for an
existing deployment. Both client and contract must be reviewed together.

## Custody and the two timestamps

Collections move directly from a holder into one shared holding token account.
Each collection has its own on-chain receipt, amount, holder, nonce, consent
epoch, evidence hash, collection time, release time and expiry. Later deposits
do not inherit an older receipt's timer. There is no midnight rollover and no
second reconciliation wallet. Only reviewed amounts move to the spendable
treasury; buyback cannot spend the holding account.

The collector and reviewer retain finalized payout signatures, source-wallet
arrival chain times, amounts and subsequent spending in their off-chain evidence
stores. A collection can cover several payouts. Its on-chain receipt records the
time funds entered holding custody and links to evidence by hash; it does not
store every wallet arrival timestamp. The 24-hour timer starts at collection.

- Before release, a holder can reclaim their entire pending receipt. An approved
  receipt remains reclaimable until release actually executes.
- Earliest review/release is 24 elapsed hours after collection. Approval and
  release are submitted atomically by the reviewer service.
- Partial approval returns the remainder to the original holder's canonical
  PUMP account. Full rejection returns everything.
- At 72 hours the receipt becomes refund-only, including if already approved.
  A transaction must still execute the refund; time alone never moves tokens.
- Refunds disable collection and require fresh signed consent to restart. Old
  receipts cannot be released under a new consent epoch.
- Expiry, disabled/obsolete consent, retirement or the actual 200M treasury goal
  allow anyone to execute the fixed-destination refund. The holder and reviewer
  can refund sooner. Pauses do not disable recovery.
- Released amounts are permanent contributions and cannot be reclaimed by this
  system. Reclaim and release transactions race; the first successful execution
  wins. A missing original refund account is recreated at the caller's expense.

The holder's right to reclaim was approved by Roy. PENIS-only reward scope,
separate immutable service roles, the 72-hour deadline and refunding all remaining
pending receipts at the goal are proposed policy choices for review.

## Evidence and remaining trust

The services credit only PUMP transfers from the pinned distributor account that
also have a public Stonk batch record identifying PENIS as the generating mint.
The distributor alone cannot distinguish rewards from different coins. Purchases,
other-coin payouts, ambiguous same-slot ordering and incomplete history create no
positive eligibility. Outgoing PUMP consumes eligible rewards first; spending and
buying PUMP later cannot replenish reward credit. Reset boundaries discard
uncollected eligibility, while previously supported held-receipt decisions remain
available through their review window. This intentionally prefers missed rewards
or refunds to collecting an unproven shortfall.

These are trusted off-chain attestations, not cryptographic on-chain proofs of
origin. Exact-balance checks cannot prevent every spend/rebuy race. A compromised
collector can temporarily take ineligible PUMP within the contract's bounds; the
holder or an honest reviewer can recover it before release. A compromised
reviewer can wrongly approve what was already collected. Separate keys do not
give independent review if they share an operator, compromised infrastructure,
or false upstream data. The upgrade authority is another trust boundary.

Stonk's public feed exposes only the latest 100 records. Each role archives those
records independently while available and reads complete finalized source-account
history back to its saved cursor. Missing API records cannot be reconstructed from
the daily total and do not create credit. This cannot promise capture of every
payout after an outage. Receipt evidence hashes are not public evidence storage:
retain the corresponding records and arrange access for reviewers.

The PUMP mint fixture is Token-2022 with an inactive but controllable transfer
hook. A future hook activation can block transfers, including refunds. The
contract rejects fee-bearing reward mints and unequal debited/received amounts;
it cannot override external token controls. Verify live mint configuration and
program-owned treasury reward eligibility before launch.

## Services and rollout gate

`lib/holding/release.ts` deliberately sets `HOLD_COLLECTION_RELEASED=false`.
Enrollment and `--submit` are disabled. No keys, deployment, persistent runner or
production scheduler are supplied here. Reclaim/stop actions are not gated by
that launch flag.

Use Node 24+ and the repository dependencies. Provision two independent persistent
workers with separate evidence stores and separately secured role keys. Each
invocation performs one pass; the operator schedules later passes. The feed is
fetched once per pass, not once per wallet. Start with read-only passes:

```sh
SOLANA_RPC_URL=https://your-rpc.example HOLD_DATA_DIR=/durable/collector \
  npm run holding:once -- --role=collector
SOLANA_RPC_URL=https://your-rpc.example HOLD_DATA_DIR=/durable/reviewer \
  npm run holding:once -- --role=reviewer
```

Both require reviewed flagship configuration. After a separately reviewed test
deployment and release-gate change, `HOLD_KEYPAIR_FILE` supplies that role's secret
file and `--submit` enables transactions. The key must match the on-chain role.
Never put secret files or evidence stores in the repository. The roles must not
share `HOLD_DATA_DIR`; its role marker and process lock reject that configuration.
Never run these journals on an ephemeral web-function filesystem.

Collector feed/history failures stop collection. Reviewer feed failure supplies
no new credit while allowing existing supported decisions and refunds to proceed.
A history failure resets uncertain eligibility and stops that tick before signing;
later passes refund unsupported receipts. Monitor nonzero exits, missing runs,
old pending receipts, journal integrity, role SOL balances and unsuccessful
refunds. The browser gives holders a separate recovery route if either service
is offline, including after deregistration or pool-read failures.

Before broadcasting, both services persist the exact signed transaction. Unknown
send outcomes are resolved using finalized signature status, nonce/receipt state
and blockhash expiry before signing again. Do not delete a journal/outbox to
resolve an ambiguous send. After a crash, remove a stale process lock only after
confirming no worker still owns it, then resume with the original durable data.
Investigate corrupt journals instead of silently replacing them. Retain backups
and evidence through settlement; archive older settled decisions only with a
separately reviewed retention process. No automatic compaction is implemented.

## Keeper, allowance and monitoring compatibility

The generated holding schema describes the contract's exact version-3 layouts.
Unknown layouts fail closed. Counting/refresh take four accounts per holder,
including durable consent, and use batches of six. Disabled consent counts zero
at the next applicable count. The holding buyback ABI omits the old donation
account; it buys only with the existing spendable treasury.

The upstream reward allowance remains an optional additional bound. When enabled,
its `post_reward_total` maintenance is still required; this worker does not post
those daily totals. Without that maintenance collection can stop or undercollect.
Agree the intended parameters before launch. Neither that allowance nor daily
API/volume comparisons establishes individual payout provenance.

`total_swept` / per-holder `total_contributed` are gross historical collections,
including amounts later refunded. `CollectionPolicy.pending`, `.released` and
`.refunded` and settlement events describe their disposition. Daily sanity reports
compare gross collections to an approximate PENIS reward share and cannot approve
release, guarantee net retained contributions or authorize recovering a shortfall.

Costs grow with active wallets, their transaction histories, scan frequency and
collection count. Each receipt temporarily ties up rent, returned to its original
payer when closed; the durable consent record keeps its small rent deposit.
Collection and settlement also pay transaction fees. Independent review adds
history reads and storage. Measure these on representative wallets before choosing
a cadence; this PR makes no fixed monthly-price or real-time performance claim.

## Validation and review map

- `lib/holding/client.ts`, `codec.ts`, `schema.json`: exact ABI and fixed recipients.
- `snapshot.ts`: one finalized bank for balances, consent, lifecycle and capacity.
- `feed.ts`, existing `reporter/classify.ts`: API archive and payout attribution.
- `reconcile.ts`, `worker.ts`: independent history replay and release decisions.
- `outbox.ts`, existing reporter journal/engine: restart and ambiguous-send safety.
- `exit.ts`, `HoldingPanel.tsx`: wallet-signed opt-out and pending reclaim.

```sh
npm test
npm run lint
npx tsc --noEmit
npm run build
node scripts/sync-holding-schema.mjs /absolute/path/to/endowment/target/idl/endowment.json --check
```

The committed public fixture is generated by Rust/LiteSVM; tests compare actual
Rust sweep bytes, account ordering and privileges against the TypeScript client.
Other tests cover spent rewards versus purchased PUMP, overlapping receipt
timers, missing/ambiguous evidence, outbox restart, preserved review decisions,
keeper layout compatibility and invalid schemas. These are automated tests and
self-review, not an independent audit or evidence of a successful live pilot.
Before launch, agree the policy and role custody, exercise both services through
outages on a test deployment, verify refunds and obtain independent review.
