import { mkdir, open, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { distributions } from "../reporter/classify.ts";
import type { Distribution } from "../reporter/types.ts";
import { PENIS_MINT, PUMP_MINT } from "../endowment.ts";

/** Each role archives the public feed independently. A cached entry is still
 * API evidence, not a cryptographic proof. Missing entries create no credit. */
export async function archiveFeed(
  directory: string,
): Promise<Map<string, Distribution>> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "payout-feed.json");
  let cached: unknown = { data: { recentDistributions: [] } };
  try {
    cached = JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const records = distributions(cached);
  const response = await fetch(
    "https://www.stonkfun.xyz/api/public/v1/rewards?limit=100",
    {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok) throw new Error(`Payout feed HTTP ${response.status}`);
  for (const [signature, entry] of distributions(await response.json())) {
    if (entry.mint !== PENIS_MINT || entry.quoteMint !== PUMP_MINT) continue;
    const prior = records.get(signature);
    if (prior && JSON.stringify(prior) !== JSON.stringify(entry))
      throw new Error("Public payout record changed; stop and investigate");
    records.set(signature, entry);
  }
  const file = await open(path + ".tmp", "w", 0o600);
  try {
    await file.writeFile(
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        data: { recentDistributions: [...records.values()] },
      }),
    );
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(path + ".tmp", path);
  const dir = await open(directory, "r");
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
  return records;
}
