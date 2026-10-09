# Launch steps

`scripts/launch.mts` prepares or runs the on-chain setup steps. It does not deploy the program, create multisigs, transfer upgrade authority, start workers, or open website delegation. Use Node 24+ and set `SOLANA_RPC_URL` to the intended endpoint; a free RPC is acceptable only if the pilot demonstrates sufficient capacity and history access.

The command modes are deliberately different:

- `addresses` derives addresses without an RPC. `status` reads current on-chain configuration.
- Local signer commands simulate first and submit only with `--send`.
- `--admin <vault>` **only prints** instructions and a base58 transaction message for Squads. It does not simulate, approve or submit them. `--send` is refused in this mode. Review and simulate the actual Squads transaction before both admin members approve it; regenerate an expired message.
- `--admin-key <file> --rehearsal` is for a local fork only. The helper requires a loopback RPC URL for this mode; that URL check is not proof that a proxy points to a fork. Verify the endpoint before loading a key. Never use production private keys to rehearse.

```
node scripts/launch.mts addresses
node scripts/launch.mts status
node scripts/launch.mts create --params launch.json --creator-key <creator key file> [--send]
node scripts/launch.mts init-collection --collector <addr> --reviewer <addr> --admin <Squads vault>
node scripts/launch.mts propose-params --params public.json --admin <Squads vault>
node scripts/launch.mts apply-params --admin <Squads vault>
node scripts/launch.mts status
```

- **`create`** must be signed by the flagship creator key. It accepts only founders mode (0/0). Set `admin` to the 2-of-2 Squads **vault address** and `guardian` to the separate 1-of-2 guardian vault. The multisig configuration account address is not the signing vault. Default/system addresses are rejected for every role, including rehearsals; they would otherwise silently become the creator key in the contract. Production roles must not use the creator key.
- **Role setup:** use distinct admin, guardian, collector, reviewer and refresher addresses. Initialization checks collector/reviewer against the live config; parameter proposals and application check the proposed refresher against existing collection roles. The helper also rejects an admin address that differs from the on-chain config. These checks verify addresses, not who controls their keys or the real multisig quorum.
- **Admin steps:** the Squads vault pays rent for new accounts (`init-collection` creates the policy and pending token account). Any required transaction fee payer also needs SOL. Prepare, inspect and simulate through Squads before execution.
- **Applying parameters:** only the admin can apply when the 72-hour timelock first expires. Use `apply-params --admin <vault>` to prepare that Squads transaction. After an additional 24-hour grace period, `apply-params --payer-key <file> [--send]` can simulate/submit permissionlessly. A prepared message is not proof that the timelock has elapsed or that execution will succeed.

## Required custody checks before funding a pilot

Roy and Brett verify and record the following together. The helper does **not** verify these conditions:

- Admin and upgrade authority require both of their votes (2-of-2). The separate emergency guardian allows either of their votes (1-of-2). Check actual voter membership, thresholds, vault addresses and the multisig `configAuthority`: there must not be a separate single-key authority able to rewrite membership or lower the threshold.
- The deployed program's upgrade authority is the agreed 2-of-2 vault. Verify the deployed binary against the reviewed repository commit. Matching code proves the deployed version; it does not replace security review.
- Roy controls separate reviewer and refresher signing keys and their host; Brett controls the collector and its host. Do not put Roy's refresher key into Brett's website/keeper environment. A different public key on the same compromised host does not provide independent custody. See [keeper setup](keeper.md).
- Confirm backups and recovery without publishing private keys, and test both multisig members' signing paths. Test that either guardian can pause and that a single admin member cannot restart, change parameters or upgrade the program.
- Record agreed buy limits, rewards ceiling, minimum stake, tip, founders list and a small cumulative funded-test budget. Example values below are not an approval to fund or collect.

## Rehearsal, observation and release order

Use the detailed [pilot runbook](launch-pilot-runbook.md) for pass criteria and incident handling. Keep public delegation closed throughout the following setup and tests.

1. Fix and review launch-blocking contract issues, then rehearse the whole flow on a mainnet fork, including pause/restart and the irreversible founders-to-public transition.
2. Build the reviewed commit reproducibly, deploy, verify the binary and transfer upgrade authority to the agreed 2-of-2 vault. Create in founders mode, verify roles/parameters, then initialize collection through Squads.
3. Configure separate workers, durable state and independent alerts. Enroll only the agreed founders through a tested founder-only flow: owners sign registration, consent and token delegation. Complete the required spaced balance attestations and a count. An observation week with no enrolled, eligible wallets is not a useful pilot. Configuration and count/reward posting are on-chain actions; “read-only week” means the collector/reviewer do not collect, release or refund real contributions.
4. Observe real eligible payouts and unrelated PUMP activity for the agreed period. Confirm reports contain the enrolled founders, alerts fire when each worker stops or fails, and the evidence coverage is complete. Agree pass criteria before collecting real funds.
5. Both approve the small funded founders test and its stop conditions. Test the complete collection/hold/refund/reclaim/release flow, purchase and spend/rebuy edge cases, outages, pause/restart, budgets and a key rotation. Verify the result together before public mode.
6. Through the 2-of-2 admin, propose the full public parameter set with thresholds 3000/2500. Wait the on-chain 72-hour timelock, then **apply** it through Squads. Preparing a proposal or waiting alone does not change the mode.
7. Confirm the application transaction and read `status`: `publicLocked` must be true, thresholds 3000/2500, and no pending parameter proposal. Verify the founders' count/activation and carried reward allowance were reset. This transition is irreversible; public collection needs new attestations/counts and eligible reward posts.
8. Only after that verification, open public pledging. Collecting waits for a fresh count reaching 30%; it pauses below 25% and resumes at 30%. Do not require 30% before opening pledging, because holders need a way to enroll first.
9. Removal of upgrade authority is a later, separate joint decision. Keep the admin/restart and emergency-pause arrangements unless an explicitly reviewed change requires otherwise.

## Funding assumptions

Measure transaction/RPC usage and maximum concurrent pending receipts during the pilot before treating a monthly estimate as a budget. Receipt rent is temporary collector working capital returned on settlement; operating fee balances are reserves, not immediate spending. Fund all roles that submit transactions, including reviewer and refresher.

Program deployment rent should be budgeted as committed capital: after removing upgrade authority, the program can no longer be closed to reclaim that rent. Even while authority remains, closing a program with live vaults is not a safe refund plan. Squads currently lists a 0.1 SOL creation fee per multisig, in addition to account rent and network costs; confirm current prices before funding. References: [Solana deployment](https://solana.com/docs/core/programs/program-deployment), [Squads costs](https://docs.squads.so/main/additional-resources/costs-of-using-squads).

## Parameter file

u64 amounts are decimal strings in base units (6 decimals); the rest are numbers. The script checks the contract's own rules before signing: thresholds 0/0 or 3000/2500, allowance exactly 10000, `max_rewards_per_day` at most 10 × `max_buy_per_day`, `buy_bps` 10000, and every hard-coded bound.

The values below are **placeholders to show the format, not chosen launch numbers**:

```json
{
  "admin": "<Squads 2-of-2 vault>",
  "guardian": "<Squads 1-of-2 vault>",
  "params": {
    "max_buy_per_tx": "500000000000",
    "max_buy_per_day": "5000000000000",
    "min_buy_amount": "1000000000",
    "min_buy_interval_secs": "900",
    "max_rewards_per_day": "20000000000000",
    "max_price_impact_bps": 100,
    "max_twap_deviation_bps": 300,
    "tip_bps": 25,
    "buy_bps": 10000,
    "activate_bps": 0,
    "deactivate_bps": 0,
    "min_stake_bps": 10,
    "allowance_margin_bps": 10000,
    "refresher": "<refresher address>"
  }
}
```

`propose-params` takes the same `params` object on its own (no admin or guardian).
