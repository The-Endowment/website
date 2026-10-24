# Bounded RPC read retries

Only an explicit set of read methods retries: account, program, history, transaction/status, blockheight/blockhash, slot and balance reads. Each call gets at most three attempts, with 250 ms and 750 ms delays and the existing 20-second timeout per attempt. Every attempt uses the same finalized parameters, cursor and minimum slot.

Retries cover HTTP 408/429/500/502/503/504, RPC unhealthy-node/context-lag/internal errors, and recognized temporary connection/timeout failures. Authorization failures, malformed replies, unsupported transaction versions and invalid parameters do not retry. A successful RPC response containing missing, inconsistent or pruned history is still a gap. Exhausted retries still reach the existing stop/quarantine handling.

`sendTransaction` and unlisted methods never retry automatically. A broadcast timeout remains ambiguous and belongs to durable outbox recovery.

The shared RPC reader is used by the holding worker and refresher. This change does not enable signing or change the journal, feed or collection policies. Deploy reviewed worker changes to both servers with their journals and operational stop files intact. Sweep and release remain separately controlled.
