// Extract only the ABI used by this client from a locally built Anchor IDL.
import { readFile, writeFile } from "node:fs/promises";
const file = process.argv[2];
if (!file)
  throw new Error(
    "Usage: node scripts/sync-holding-schema.mjs /path/to/target/idl/endowment.json [--check]",
  );
const idl = JSON.parse(await readFile(file, "utf8"));
if (idl.address !== "5VBiPX39xFTgwRaUbC3F3HCuVcM3VkTuYDkxwrhYby2u")
  throw new Error("Unexpected program");
const names = new Set([
  "register_landlord",
  "resync_baseline",
  "deregister_landlord",
  "enable_collection",
  "disable_collection",
  "initialize_collection",
  "sweep",
  "review_collection",
  "release_collection",
  "refund_collection",
  "buyback",
  "begin_count",
  "finish_count",
  "prune_landlord",
]);
const roots = [
  "Config",
  "Landlord",
  "CollectionPolicy",
  "CollectionConsent",
  "PendingCollection",
  "CollectionReport",
];
const definitions = Object.fromEntries(idl.types.map((x) => [x.name, x.type])),
  types = {};
function visit(name) {
  if (types[name]) return;
  const source = definitions[name];
  if (source?.kind !== "struct") throw new Error(`Unexpected type ${name}`);
  types[name] = {
    kind: "struct",
    fields: source.fields.map(({ name, type }) => ({ name, type })),
  };
  const inner = (t) => {
    if (t.defined) visit(t.defined.name);
    if (t.array) inner(t.array[0]);
  };
  for (const f of source.fields) inner(f.type);
}
roots.forEach(visit);
const accounts = Object.fromEntries(
  idl.accounts
    .filter((x) => roots.includes(x.name))
    .map((x) => [x.name, x.discriminator]),
);
const instructions = Object.fromEntries(
  idl.instructions
    .filter((x) => names.has(x.name))
    .map((x) => [
      x.name,
      {
        discriminator: x.discriminator,
        accounts: x.accounts.map(({ name, writable, signer }) => ({
          name,
          ...(writable ? { writable } : {}),
          ...(signer ? { signer } : {}),
        })),
        args: x.args.map(({ name, type }) => ({ name, type })),
      },
    ]),
);
const data =
  JSON.stringify(
    { address: idl.address, accounts, types, instructions },
    null,
    2,
  ) + "\n";
const destination = new URL("../lib/holding/schema.json", import.meta.url);
if (process.argv.includes("--check")) {
  if (data !== (await readFile(destination, "utf8")))
    throw new Error("Client schema differs from compiled contract IDL");
} else await writeFile(destination, data);
