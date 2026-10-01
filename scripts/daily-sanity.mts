import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { dailySanity, parseSnapshot, type DailyReport, type DailySnapshot } from "../lib/daily-sanity.ts";

type DailyRecord = { snapshot: DailySnapshot; report: DailyReport };

/** One persistent file per UTC observation day, containing both snapshot and report. */
export async function saveDailyCheck(directory: string, load: () => Promise<unknown>, now = new Date(), toleranceBps = 5_000): Promise<DailyRecord> {
  await mkdir(directory, { recursive: true });
  const lock = join(directory, ".lock");
  await mkdir(lock); // Refuse concurrent writers instead of replacing another run's sample.
  try {
    const day = now.toISOString().slice(0, 10);
    const files = (await readdir(directory)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    const latest = files.at(-1);
    if (latest && latest > `${day}.json`) throw new Error("Snapshot directory contains a future day");
    const previous: DailyRecord | null = latest ? JSON.parse(await readFile(join(directory, latest), "utf8")) : null;
    if (latest && !previous) throw new Error("Invalid saved daily record");
    if (previous) {
      parseSnapshot(previous.snapshot);
      if (`${previous.snapshot.observedAt.slice(0, 10)}.json` !== latest || previous.report?.to !== previous.snapshot.observedAt
          || !["baseline", "within_range", "review", "inconclusive", "no_activity"].includes(previous.report.status)) {
        throw new Error("Invalid saved daily record");
      }
    }
    if (latest === `${day}.json` && previous) return previous; // Preserve the original boundary on retries.
    const current = parseSnapshot(await load());
    if (current.observedAt.slice(0, 10) !== day || Math.abs(Date.parse(current.observedAt) - now.getTime()) > 5 * 60_000) {
      throw new Error("Snapshot does not match this run's observation time");
    }
    const record = { snapshot: current, report: dailySanity(previous?.snapshot ?? null, current, toleranceBps) };
    const temporary = join(directory, ".pending.json");
    await writeFile(temporary, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
    await rename(temporary, join(directory, `${day}.json`));
    return record;
  } finally {
    await rm(lock, { recursive: true });
  }
}

async function main() {
  const base = process.env.KEEPER_URL;
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) throw new Error("Set KEEPER_URL and CRON_SECRET");
  const url = new URL("/api/keeper/daily-snapshot", base);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("KEEPER_URL must use HTTPS (HTTP is allowed only for local testing)");
  }
  const record = await saveDailyCheck(
    resolve(process.env.SANITY_DATA_DIR ?? ".daily-sanity"),
    async () => {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${secret}` }, cache: "no-store", redirect: "error",
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) throw new Error(`Daily snapshot request returned HTTP ${response.status}`);
      return response.json();
    },
    new Date(), Number(process.env.SANITY_TOLERANCE_BPS ?? 5_000),
  );
  console.log(JSON.stringify(record.report, null, 2));
  if (["review", "inconclusive"].includes(record.report.status)) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
