import { readFileSync } from "node:fs";
import { address, getAddressEncoder } from "@solana/kit";

type IdlType = string | { defined: { name: string } } | { array: [IdlType, number] };
type Idl = {
  accounts: { name: string; discriminator: number[] }[];
  types: { name: string; type: { kind: string; fields: { name: string; type: IdlType }[] } }[];
};
const idl = JSON.parse(readFileSync(new URL("../fixtures/reporter-idl.json", import.meta.url), "utf8")) as Idl;

/** Encode fixtures from the generated Rust IDL, independently of the client decoder. */
function encode(type: IdlType, value: unknown): Uint8Array {
  if (typeof type !== "string") {
    if ("array" in type) {
      const values = value as unknown[] | undefined;
      return Buffer.concat(Array.from({ length: type.array[1] }, (_, i) => encode(type.array[0], values?.[i])));
    }
    const definition = idl.types.find((entry) => entry.name === type.defined.name);
    if (!definition || definition.type.kind !== "struct") throw new Error(`Unsupported IDL type ${type.defined.name}`);
    const fields = (value ?? {}) as Record<string, unknown>;
    return Buffer.concat(definition.type.fields.map((field) => encode(field.type, fields[field.name])));
  }
  if (type === "pubkey") return new Uint8Array(getAddressEncoder().encode(address(String(value ?? "11111111111111111111111111111111"))));
  if (type === "bool") return Uint8Array.of(value ? 1 : 0);
  const sizes: Record<string, number> = { u8: 1, u16: 2, u32: 4, u64: 8, i64: 8 };
  const size = sizes[type];
  if (!size) throw new Error(`Unsupported IDL primitive ${type}`);
  const data = Buffer.alloc(size);
  if (type === "i64") data.writeBigInt64LE(BigInt(String(value ?? 0)));
  else if (type === "u64") data.writeBigUInt64LE(BigInt(String(value ?? 0)));
  else data.writeUIntLE(Number(value ?? 0), 0, size);
  return data;
}

export function idlAccount(name: string, fields: Record<string, unknown>): Uint8Array {
  const account = idl.accounts.find((entry) => entry.name === name);
  if (!account) throw new Error(`Unknown IDL account ${name}`);
  return Buffer.concat([Uint8Array.from(account.discriminator), encode({ defined: { name } }, fields)]);
}
