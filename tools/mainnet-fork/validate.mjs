import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { decodeAccount } from "../../lib/holding/codec.ts";
import { json } from "./capture.mjs";

export async function validate(directory) {
  const snapshot = JSON.parse(await fs.readFile(new URL("snapshot.json", directory), "utf8"));
  const result = JSON.parse(await fs.readFile(new URL("vm-results.json", directory), "utf8"));
  const decode = bytes => decodeAccount("Config", Buffer.from(bytes, "base64"));
  const post = decode(result.appliedConfig);
  const count = decode(result.countedPublicConfig);
  const ordinary = decode(result.permissionlessAppliedConfig);
  assert.ok(result.checks.every(check => check.passed));
  function requireCode(text, code) {
    const row = result.checks.find(check => check.check.includes(text));
    assert.ok(row, text);
    assert.match(row.error, new RegExp(`Custom\\(${code}\\)`));
  }
  requireCode("one second before 72", 6024);
  requireCode("cannot apply during admin", 6042);
  requireCode("One approval cannot", 6008);
  requireCode("cannot be replayed", 6008);
  requireCode("cannot undo", 6023);
  requireCode("restore founder", 6064);
  requireCode("below the 10 bps", 6032);
  requireCode("before 96 hours", 6042);
  requireCode("Expired pending", 6041);
  assert.equal(post.reserved[0], 1);
  assert.equal(post.active, false);
  assert.equal(post.params.activate_bps, 3000);
  assert.equal(post.params.deactivate_bps, 2500);
  assert.equal(post.params.min_stake_bps, 10);
  assert.equal(post.pending.effective_at, 0n);
  assert.equal(post.reward_credit_ok, false);
  assert.equal(post.last_count_bps, 0);
  assert.equal(post.last_count_at, 0n);
  assert.equal(post.last_committed, 0n);
  assert.equal(post.count.open, false);
  assert.ok(post.reward_marks.every(mark => mark.at === 0n && mark.index === 0n));
  assert.equal(post.refresher_epoch, snapshot.config.refresher_epoch + 1);
  assert.deepEqual(post, ordinary);
  assert.equal(count.active, false);
  assert.ok(count.last_count_bps > 0 && count.last_count_bps < 3000, "The two founder wallets must remain below public activation for this scenario");
  assert.equal(count.count.open, false);
  assert.equal(count.count.counted, 2);
  assert.equal(count.count.expected, 2);
  assert.equal(count.count.min_stake, (count.count.supply * 10n + 9999n) / 10000n);
  assert.equal(count.params.activate_bps, 3000);
  assert.equal(count.params.deactivate_bps, 2500);
  for (const account of result.pumpAccounts) assert.equal(account.dataAfter, account.dataBefore);
  for (const cancelled of result.cancelledConfigs) {
    const config = decode(cancelled.configAfter);
    assert.equal(config.pending.effective_at, 0n);
    assert.equal(config.reserved[0], 0);
    assert.deepEqual(JSON.parse(json(config.params)), snapshot.config.params);
  }
  const checks = { runtimeChecks: result.checks.length, publicThresholdsExact: true,
    minimumHoldingEnforced: true, publicLockIrreversible: true, publicCollectionInactiveBelow30Percent: true,
    freshFounderCountRequired: true, pendingParamsCleared: true, oldRewardCreditDiscarded: true,
    refresherEpochAdvanced: true, cancelLeavesLiveParamsUnchanged: true, pumpTokenAccountsUnchanged: true,
    adminAndOrdinaryApplyHaveIdenticalResult: true, expectedErrorCodesChecked: true };
  await fs.writeFile(new URL("state-checks.json", directory), json({ checkedAt: new Date().toISOString(), checks }) + "\n");
  return checks;
}
