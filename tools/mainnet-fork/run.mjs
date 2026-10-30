import fs from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { capture, json } from "./capture.mjs";
import { prepare } from "./prepare.mjs";
import { validate } from "./validate.mjs";

if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Use Node 24 or newer");
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--output" || !args[1])) throw new Error("Usage: node tools/mainnet-fork/run.mjs [--output <new-directory>]");
const directory = pathToFileURL(resolve(args[1] || fileURLToPath(new URL(`output/${new Date().toISOString().replaceAll(":", "-")}`, import.meta.url))) + sep);
await fs.mkdir(new URL("..", directory), { recursive: true });
await fs.mkdir(directory, { recursive: false }); // Never overwrite a previous run.
await capture(directory);
await prepare(directory);
const result = spawnSync("cargo", ["run", "--locked", "--offline", "--manifest-path", fileURLToPath(new URL("vm/Cargo.toml", import.meta.url)), "--", fileURLToPath(directory)], { stdio: "inherit" });
if (result.status !== 0) throw new Error("Local VM rehearsal failed; no on-chain transaction was sent");
const stateChecks = await validate(directory);
const snapshot = JSON.parse(await fs.readFile(new URL("snapshot.json", directory), "utf8"));
const vm = JSON.parse(await fs.readFile(new URL("vm-results.json", directory), "utf8"));
const summary = { rehearsedAt: new Date().toISOString(), sourceSlot: snapshot.slot, sourceCapturedAt: snapshot.capturedAt, environment: vm.environment,
  scope: { mainnetProgramELF: true, mainnetSquadsELF: true, mainnetAccountSnapshot: true, productionKeysRead: false, networkWrites: false,
    signatureVerificationDisabledOnlyInLocalVM: true, nativeFeatureSet: "LiteSVM 0.10.0 defaults; not a complete validator feature-set clone", localExtraFixtures: "Three synthetic accounts for a below-minimum registration check" },
  programs: snapshot.programs, pendingEffectiveAt: vm.effectiveAt, runtimeChecks: vm.checks.map(({ check, passed, error, clockUnix }) => ({ check, passed, error, clockUnix })), stateChecks };
await fs.writeFile(new URL("summary.json", directory), json(summary) + "\n");
console.log(json({ passed: vm.checks.length, stateChecks, outputDirectory: fileURLToPath(directory), chainWrites: false }));
