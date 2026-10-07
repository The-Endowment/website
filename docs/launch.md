# Launch steps

`scripts/launch.mts` runs the on-chain launch steps. Every command simulates and prints the result; nothing is sent without `--send`. Set `SOLANA_RPC_URL` to a paid mainnet endpoint, or to a local fork for a rehearsal.

```
node scripts/launch.mts addresses
node scripts/launch.mts create --params launch.json --creator-key <creator key file> [--send]
node scripts/launch.mts init-collection --collector <addr> --reviewer <addr> --admin <Squads vault> 
node scripts/launch.mts propose-params --params public.json --admin <Squads vault>
node scripts/launch.mts apply-params --payer-key <key file> [--send]
```

- **`create`** must be signed by the flagship creator key. It only accepts founders mode (0/0); public mode comes later through a timelocked proposal. Set `admin` and `guardian` in the file to the Squads addresses (the 2-of-2 admin and the 1-of-2 guardian), so no handover is needed.
- **Admin steps** take `--admin <vault>`. They print the instruction and a base58 transaction message for the Squads transaction builder, and send nothing. On a fork rehearsal, `--admin-key <file>` signs directly instead. The vault pays rent for any new accounts (`init-collection` creates two), so fund it first.
- **Going public** (`propose-params` with 3000/2500) is irreversible once applied: the thresholds lock at 30%/25%, the founders' count and carried allowance are cleared, and collection waits for a fresh count reaching 30%. Rehearse it on a fork first.

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
