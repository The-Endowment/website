// Creates a Solana key file (solana-keygen's 64-byte JSON format) without the
// Solana CLI and prints its address. Refuses to overwrite an existing file.
import { generateKeyPairSync } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { getAddressDecoder } from "@solana/kit";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node scripts/ops/new-key.mjs <output file>");
  process.exit(1);
}
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
// The last 32 bytes of the DER encodings are the raw seed and public key.
const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
await writeFile(path, JSON.stringify([...seed, ...pub]), { flag: "wx", mode: 0o600 });
console.log(getAddressDecoder().decode(pub));
