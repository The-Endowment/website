import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { COUNT_MAX_AGE, ENDOWMENT_GOAL, SNAPSHOT_MAX_AGE, type Progress, type ProgressSnapshot } from "../lib/progress.ts";
import { loadTsxModule } from "./support/tsx-render.mts";

const now = 1_800_000_000;
const snapshot: ProgressSnapshot = {
  kind: "ready", observedAt: now, slot: 1, config: "config", vault: "vault",
  held: "50000000000000", committed: "280000000000000", committedBps: 2800,
  lastCountAt: now, active: true, pausedUntil: 0, retired: false, milestoneReached: false,
};

function render(data: Progress | null) {
  // Seed the component's existing data/clock state. Effects do not run during
  // SSR; the real state selector, formatting, meters and markup all execute.
  const initialState = [data, now];
  const { EndowmentProgress } = loadTsxModule<{ EndowmentProgress: React.ComponentType }>(
    "components/EndowmentProgress.tsx", {
      react: { ...React, useState: () => React.useState(initialState.shift()) },
      "next/link": ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement("a", { href }, children),
      "./DelegateButton": { DelegateButton: () => null },
      "./DonationButton": { DonationButton: () => null },
    },
  );
  return renderToStaticMarkup(React.createElement(EndowmentProgress));
}

function status(html: string) {
  return html.match(/role="status">([^<]*)<\/span>/)?.[1];
}

test("28% displays either active or inactive participation without claiming collection is running", () => {
  const active = render(snapshot);
  const inactive = render({ ...snapshot, active: false });
  assert.equal(status(active), "Participation active");
  assert.equal(status(inactive), "Building to 30%");
  for (const html of [active, inactive]) {
    assert.match(html, /aria-label="Pledged supply"[^>]*aria-valuenow="28"/);
    assert.doesNotMatch(html, /over 30%|collection is on|>Collecting</);
  }
  assert.match(active, /does not confirm that reward collection is running/);
  assert.match(inactive, /other checks and the collection service/);
});

test("missing or expired snapshots hide totals instead of displaying zero or promising a refresh", () => {
  for (const data of [{ kind: "unavailable" } as const, { ...snapshot, observedAt: now - SNAPSHOT_MAX_AGE - 1 }]) {
    const html = render(data);
    assert.equal(status(html), "Totals unavailable");
    assert.doesNotMatch(html, /role="progressbar"|in a moment|50,000,000/);
    assert.match(html, /No verified vault total/);
  }
  const uncounted = render({ ...snapshot, lastCountAt: 0 });
  assert.equal(status(uncounted), "First count pending");
  assert.match(uncounted, /aria-label="Endowment goal"/);
  assert.doesNotMatch(uncounted, /aria-label="Pledged supply"/);
});

test("stale participation and a pause retain the last totals without promising automatic resumption", () => {
  const stale = render({ ...snapshot, lastCountAt: now - COUNT_MAX_AGE - 1 });
  const paused = render({ ...snapshot, pausedUntil: now + 1 });
  assert.equal(status(stale), "Count out of date");
  assert.equal(status(paused), "Paused");
  for (const html of [stale, paused]) {
    assert.match(html, /aria-label="Pledged supply"[^>]*aria-valuenow="28"/);
    assert.doesNotMatch(html, /Collection resumes|collection is on/);
  }
  assert.match(stale, /fresh participation count is required/);
  assert.match(paused, /other collection conditions still need to be met/);
});

test("the goal stops reward collection while keeping above-goal balances and separate donations visible", () => {
  const html = render({ ...snapshot, held: (ENDOWMENT_GOAL * 5n / 4n).toString() });
  assert.equal(status(html), "Goal reached");
  assert.match(html, /250,000,000/);
  assert.match(html, /aria-label="Endowment goal"[^>]*aria-valuenow="100"/);
  assert.match(html, /Reward collection has ended; direct donations are separate/);
  assert.doesNotMatch(html, /Closed to contributions/);
});
