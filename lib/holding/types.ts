import type { Address } from "@solana/kit";
export type Policy = {
  config: Address;
  collector: Address;
  reviewer: Address;
  bump: number;
  pending: bigint;
  released: bigint;
  refunded: bigint;
};
export type Consent = {
  config: Address;
  owner: Address;
  bump: number;
  enabled: boolean;
  epoch: bigint;
  next_nonce: bigint;
  started_at: bigint;
};
export type Receipt = {
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
export type Config = {
  version: number;
  coin_mint: Address;
  dividend_mint: Address;
  pool: Address;
  retired: boolean;
  milestone_reached: boolean;
  active: boolean;
  paused_until: bigint;
  last_count_at: bigint;
  contribution_cap: bigint;
  refresher_epoch: number;
  reward_index: bigint;
  params: {
    activate_bps: number;
    max_buy_per_tx: bigint;
    max_buy_per_day: bigint;
    min_buy_interval_secs: bigint;
    allowance_margin_bps: number;
  };
};
export type Landlord = {
  version: number;
  config: Address;
  owner: Address;
  dividend_account: Address;
  coin_account: Address;
  baseline: bigint;
  index_at: bigint;
  allowance: bigint;
  counted_amount: bigint;
};
