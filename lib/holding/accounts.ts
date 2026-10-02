// Generated from the reviewed Anchor IDL; run scripts/sync-holding-schema.mjs.
import type { Address } from "@solana/kit";

export type Config = {
  version: number;
  creator: Address;
  admin: Address;
  pending_admin: Address;
  guardian: Address;
  coin_mint: Address;
  dividend_mint: Address;
  pool: Address;
  bump: number;
  authority_bump: number;
  params: Params;
  pending: PendingParams;
  contribution_cap: bigint;
  paused_until: bigint;
  retired: boolean;
  retire_at: bigint;
  milestone_reached: boolean;
  active: boolean;
  last_count_at: bigint;
  last_count_bps: number;
  last_committed: bigint;
  last_attested_at: bigint;
  last_sweep_at: bigint;
  landlord_count: number;
  count: CountRound;
  buy_allowance: bigint;
  allowance_updated_at: bigint;
  last_buy_at: bigint;
  total_swept: bigint;
  total_dividend_spent: bigint;
  total_coin_bought: bigint;
  total_coin_retained: bigint;
  total_liquidity_dividend: bigint;
  total_liquidity_coin: bigint;
  total_lp_tokens: bigint;
  total_tips: bigint;
  refresher_epoch: number;
  reward_index: bigint;
  last_reward_total: bigint;
  last_reward_post_at: bigint;
  reward_marks: RewardMark[];
  pause_started_at: bigint;
  reward_credit_ok: boolean;
  reserved: number[];
};

export type Params = {
  max_buy_per_tx: bigint;
  max_buy_per_day: bigint;
  max_price_impact_bps: number;
  max_twap_deviation_bps: number;
  min_buy_amount: bigint;
  min_buy_interval_secs: bigint;
  tip_bps: number;
  buy_bps: number;
  activate_bps: number;
  deactivate_bps: number;
  min_stake_bps: number;
  refresher: Address;
  allowance_margin_bps: number;
  max_rewards_per_day: bigint;
};

export type PendingParams = {
  params: Params;
  effective_at: bigint;
};

export type CountRound = {
  round: bigint;
  open: boolean;
  started_at: bigint;
  supply: bigint;
  expected: number;
  counted: number;
  committed: bigint;
  min_stake: bigint;
};

export type RewardMark = {
  at: bigint;
  index: bigint;
};

export type Landlord = {
  version: number;
  config: Address;
  owner: Address;
  dividend_account: Address;
  coin_account: Address;
  baseline: bigint;
  total_contributed: bigint;
  registered_at: bigint;
  last_sweep_at: bigint;
  bump: number;
  joined_round: bigint;
  counted_round: bigint;
  counted_amount: bigint;
  snapshot: bigint;
  snapshot_valid: boolean;
  attestations: number;
  last_attested_at: bigint;
  attestation_epoch: number;
  index_at: bigint;
  allowance: bigint;
  first_collection_nonce: bigint;
  reserved: number[];
};

export type CollectionPolicy = {
  config: Address;
  collector: Address;
  reviewer: Address;
  bump: number;
  pending: bigint;
  released: bigint;
  refunded: bigint;
  pending_collector: Address;
  pending_reviewer: Address;
  pending_roles_at: bigint;
};

export type CollectionConsent = {
  config: Address;
  owner: Address;
  bump: number;
  enabled: boolean;
  epoch: bigint;
  next_nonce: bigint;
  started_at: bigint;
};

export type PendingCollection = {
  config: Address;
  owner: Address;
  payer: Address;
  nonce: bigint;
  consent_epoch: bigint;
  amount: bigint;
  collected_at: bigint;
  release_at: bigint;
  refund_at: bigint;
  collection_evidence: number[];
  reviewed: boolean;
  approved_amount: bigint;
  review_evidence: number[];
  bump: number;
};

export type CollectionReport = {
  consent_epoch: bigint;
  expected_balance: bigint;
  amount: bigint;
  valid_until: bigint;
  evidence_hash: number[];
};
