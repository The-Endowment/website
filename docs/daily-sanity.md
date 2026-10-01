# Daily collection sanity check

This is an approximate operational check. It compares daily growth in StonkFun's reported cumulative PENIS rewards with daily growth in the contract's cumulative holder collections. It cannot certify reward attribution, detect every failure or authorize corrective withdrawals. The [refundable collection draft](refundable-collection.md) adds separate custody and review; this aggregate check cannot authorize releasing held funds.

While the application's collection hold is in place, otherwise-eligible snapshots report `routing_pending`. Comparisons involving that state are inconclusive rather than asserting that a full day of collection should have run. The raw distribution and collection deltas remain visible.

## Calculation

```text
reported PENIS PUMP distributions = current distributedRaw − previous distributedRaw
recorded holder collections       = current totalSwept − previous totalSwept
approximate commitment            = mean of the two sampled commitment percentages
estimated PENIS contributions     = reported distributions × approximate commitment
```

The collection counter records gross historical PUMP received by successful sweeps, including amounts later refunded. Buybacks, treasury-owned rewards, gifts and changes in treasury balance do not change this counter. Use the collection policy's pending/released/refunded totals and settlement events to assess disposition. A matching daily report does not establish that collections were individually eligible or permanently retained.

The estimate and this draft's collection policy cover PENIS-generated PUMP only. StonkFun eligibility rules, fees, delayed payments, commitment changes and pauses within the day can cause differences. Two endpoint snapshots cannot reconstruct these details.

The default reporting tolerance is **50% of the estimate in either direction**, chosen as a broad initial sanity threshold, not a measured normal range. Operators can adjust `SANITY_TOLERANCE_BPS` (0–10000) after reviewing actual data. A `review` result prompts investigation; it never changes collection or moves money.

## Running it

The read-only `GET /api/keeper/daily-snapshot` endpoint uses the existing `CRON_SECRET` authentication. It requires the deployed flagship settings and `SOLANA_RPC_URL`, but does not load `KEEPER_SECRET_KEY`. It reads the config and direct coin vault together at finalized commitment and fetches the [StonkFun reward total](https://www.stonkfun.xyz/api/public/v1/tokens/JE3HT7SbCgXDQWV6xp3oiiAisDzq4HyZ8wyEVBDCs45Z/rewards). Unavailable, malformed, wrong-mint or more-than-ten-minute-old API data yields an error, never a zero total.

On a persistent runner with Node 24+, install the repository dependencies and supply:

| Variable | Purpose |
| --- | --- |
| `KEEPER_URL` | HTTPS origin of the deployed site; localhost HTTP is allowed for testing |
| `CRON_SECRET` | Existing scheduled-job bearer secret, provided through the runner's secret store |
| `SANITY_DATA_DIR` | Durable directory for daily files; defaults to `.daily-sanity` in the working directory |
| `SANITY_TOLERANCE_BPS` | Optional reporting tolerance; defaults to 5000 (50%) |

```sh
npm run sanity:daily
```

Schedule this command once a day at the same time, for example **00:05 UTC**. A runner configured for UTC can use the cron expression `5 0 * * *`. The report uses the actual observation timestamps, not an assertion that both sources were read at exactly midnight. Use the same persistent data directory on every run and retain/back up its files. No pre-launch history is needed.

Each `YYYY-MM-DD.json` contains the snapshot and report. The first run establishes a baseline; the next daily run makes the first comparison. Same-day retries return the original saved result rather than moving the boundary. A missing day produces an inconclusive comparison, then the new observation becomes the next baseline. Files are written atomically under a single-writer lock; after a runner crash, remove a leftover `.lock` directory only after confirming no process is using it. Corrupt files are errors and must be investigated rather than silently discarded.

Do not run the file-writing command inside Vercel's ephemeral filesystem or an unpersisted CI workspace. The endpoint itself is stateless; merely adding it to Vercel Cron will not retain snapshots or produce comparisons. The operator must provision the persistent runner and schedule before this becomes live. No production scheduler is enabled by this change.

## Reading the result

Amounts are exact integer PUMP base units (divide by 1,000,000 for PUMP). `differenceRaw` is actual collections minus the PENIS-only estimate.

| Status | Meaning |
| --- | --- |
| `baseline` | First observation; no comparison yet |
| `within_range` | Approximate difference is within the configured tolerance; not proof of correct collection |
| `review` | Difference exceeds tolerance, including collection when the estimate is zero |
| `inconclusive` | Non-daily interval, inactive endpoint, changed identity or regressing data; inspect the notes |
| `no_activity` | No measurable expectation or collection; cannot demonstrate that collection works |

Exit code 0 means a baseline, within-range or no-activity report was produced. Exit code 2 means the saved report needs review or is inconclusive. Exit code 1 means a source, validation or storage failure; the previous baseline remains intact. Monitor scheduled-job failures and missing runs as well as report status. Investigate keeper logs, lifecycle state, capacity limits and source freshness; do not recover an estimated shortfall from holder balances.
