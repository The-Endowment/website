# Public-mode account-fork rehearsal

This rehearses the current pending founder-to-public transition against the **deployed mainnet Endowment and Squads ELF**, using a finalized account snapshot and LiteSVM 0.10.0. It is an in-process account-state fork, not a running mainnet validator or a funded transaction test.

The capture client allows only `getGenesisHash` and `getMultipleAccounts`, verifies mainnet genesis and the exact pending 30%/25%/10-bps change, and saves the deployed program hashes. No production key is accepted or loaded. All transaction execution happens inside LiteSVM. Signature verification is disabled there so the real public member addresses can act as test signers; the deployed Squads program still checks membership, proposal status and the two-approval threshold. This does **not** test the real keys, Phantom, broadcast/confirmation, native-validator feature parity, or alert delivery.

## Run before applying public mode

Requires the website's installed dependencies, Node 24+, Rust and Cargo. Prepare the isolated SDK and Rust dependencies once:

```sh
npm ci --prefix tools/mainnet-fork --ignore-scripts
cargo fetch --locked --manifest-path tools/mainnet-fork/vm/Cargo.toml
node tools/mainnet-fork/run.mjs
```

`SOLANA_RPC_URL` optionally selects your read-only mainnet endpoint; the default is the public mainnet RPC. Provider URLs are omitted from evidence and errors. `--output /path/to/new-directory` saves the snapshot and result somewhere else. Every run uses a new directory and refuses to overwrite an existing one. Preserve the output for audit. SDK dependencies and output are ignored by Git and never enter the browser bundle.

The tool intentionally requires a pending proposal and unlocked 0% founder thresholds; fresh capture will refuse after public mode is applied. An archived capture can still be replayed directly with Cargo:

```sh
cargo run --locked --offline --manifest-path tools/mainnet-fork/vm/Cargo.toml -- /path/to/saved-output
```

Replay overwrites only the local `vm-results.json` in that saved output; copy the archive first if you need to retain an earlier run's output.

## Checks

The runtime checks cover:

- Admin apply rejected one second before maturity; ordinary apply rejected throughout the following 24-hour grace window.
- A newly created apply transaction on the cloned real multisig: one vote is insufficient; two votes allow execution through the actual vault PDA.
- Apply replay rejected; the public lock rejects a proposal to return to founder thresholds; cancellation cannot undo an applied transition.
- Fresh spaced refresher observations and a count of the two real founder wallets. Their count must remain positive and below 30%, with public collection inactive.
- Registration below the 10-bps holding minimum rejected with `StakeTooSmall`. This one scenario adds three synthetic local accounts for a holder with one PENIS; it does not change the captured mainnet account data.
- Each founder independently executing the already approved cancellation backstop, followed by apply rejection.
- Ordinary apply becoming available exactly 24 hours after maturity; expired proposals being rejected.

The state checks independently decode the resulting accounts with the website codec. They verify the exact thresholds, minimum holding, irreversible flag, cleared old count and reward marks, advanced refresher epoch, pending-param removal, identical admin/ordinary apply effects, unchanged live params after cancellation, expected program error codes and unchanged PUMP token-account data.

The current two-founder count is a rehearsal input, not a guarantee that participation stays below 30%. Launch decisions must not rely on that count to prevent collection.

## Recorded run

See [the October 30 result](../../docs/evidence/public-switch-2026-10-30.json) for the finalized source slot, deployed ELF hashes, clock boundaries, runtime checks and decoded-state assertions. The full raw snapshot, binaries and VM logs are local output, not production deployment artifacts. An independent operator should verify the deployed hashes and rerun before applying.
