import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Capture and wallet processing share storage only within the same role. */
export async function bindRoleDirectory(directory: string, role: "collector" | "reviewer") {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "role");
  try {
    const file = await open(path, "wx", 0o600);
    try { await file.writeFile(role); await file.sync(); } finally { await file.close(); }
    const dir = await open(directory, "r");
    try { await dir.sync(); } finally { await dir.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  if ((await readFile(path, "utf8")) !== role)
    throw new Error("Collector and reviewer must not share their data directory");
}
