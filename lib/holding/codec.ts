/** Borsh subset required by the checked-in, generated contract schema. No IDL
 * fetched from a server is trusted at runtime. Amounts always stay bigint. */
import {
  AccountRole,
  getAddressDecoder,
  getAddressEncoder,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import schemaJson from "./schema.json" with { type: "json" };
type Type = string | { array: [Type, number] } | { defined: { name: string } };
type Field = { name: string; type: Type };
type Schema = {
  address: string;
  accounts: Record<string, number[]>;
  types: Record<string, { fields: Field[] }>;
  instructions: Record<
    string,
    {
      discriminator: number[];
      accounts: { name: string; writable?: boolean; signer?: boolean }[];
      args: Field[];
    }
  >;
};
export const schema = schemaJson as Schema;
export const concat = (...parts: Uint8Array[]) =>
  Uint8Array.from(parts.flatMap((p) => [...p]));
function fields(type: Type): Field[] | null {
  return typeof type === "object" && "defined" in type
    ? (schema.types[type.defined.name]?.fields ?? null)
    : null;
}
function integer(type: Type) {
  return typeof type === "string"
    ? /^([ui])(8|16|32|64|128)$/.exec(type)
    : null;
}
export function encode(type: Type, value: unknown): Uint8Array {
  const fs = fields(type);
  if (fs)
    return concat(
      ...fs.map((f) =>
        encode(f.type, (value as Record<string, unknown>)[f.name]),
      ),
    );
  if (typeof type === "object" && "array" in type) {
    if (
      (!Array.isArray(value) && !(value instanceof Uint8Array)) ||
      value.length !== type.array[1]
    )
      throw new Error("Invalid array length");
    return concat(...Array.from(value).map((v) => encode(type.array[0], v)));
  }
  if (type === "pubkey")
    return Uint8Array.from(getAddressEncoder().encode(value as Address));
  if (type === "bool") {
    if (typeof value !== "boolean") throw new Error("Invalid boolean");
    return Uint8Array.of(value ? 1 : 0);
  }
  const m = integer(type);
  if (
    !m ||
    (typeof value !== "bigint" &&
      !(typeof value === "number" && Number.isSafeInteger(value)))
  )
    throw new Error("Unsupported or invalid Borsh value");
  const bits = BigInt(m[2]),
    signed = m[1] === "i";
  let n = BigInt(value);
  if (
    n < (signed ? -(1n << (bits - 1n)) : 0n) ||
    n >= 1n << (signed ? bits - 1n : bits)
  )
    throw new Error("Integer out of range");
  if (n < 0n) n += 1n << bits;
  const out = new Uint8Array(Number(bits / 8n));
  for (let i = 0; i < out.length; i++) {
    out[i] = Number(n & 255n);
    n >>= 8n;
  }
  return out;
}
export function decodeAccount<T>(name: string, data: Uint8Array): T {
  const discriminator = schema.accounts[name];
  if (!discriminator || !discriminator.every((v, i) => data[i] === v))
    throw new Error("Wrong account discriminator");
  let offset = 8;
  const take = (n: number) => {
    if (offset + n > data.length) throw new Error("Truncated account");
    const out = data.slice(offset, offset + n);
    offset += n;
    return out;
  };
  const read = (type: Type): unknown => {
    const fs = fields(type);
    if (fs) return Object.fromEntries(fs.map((f) => [f.name, read(f.type)]));
    if (typeof type === "object" && "array" in type)
      return Array.from({ length: type.array[1] }, () => read(type.array[0]));
    if (type === "pubkey") return getAddressDecoder().decode(take(32));
    if (type === "bool") {
      const n = take(1)[0];
      if (n > 1) throw new Error("Invalid boolean");
      return n === 1;
    }
    const m = integer(type);
    if (!m) throw new Error("Unsupported Borsh type");
    const bits = Number(m[2]);
    const bytes = take(bits / 8);
    let n = 0n;
    for (let i = bytes.length - 1; i >= 0; i--)
      n = (n << 8n) + BigInt(bytes[i]);
    if (m[1] === "i" && n >= 1n << BigInt(bits - 1)) n -= 1n << BigInt(bits);
    return bits <= 32 ? Number(n) : n;
  };
  const result = read({ defined: { name } });
  if (offset !== data.length) throw new Error("Unrecognized account layout");
  return result as T;
}
export function instruction(
  program: Address,
  name: string,
  accounts: Record<string, Address | TransactionSigner>,
  args: Record<string, unknown> = {},
): Instruction {
  const definition = schema.instructions[name];
  if (!definition || program !== schema.address)
    throw new Error("Unrecognized program or instruction");
  return {
    programAddress: program,
    data: concat(
      Uint8Array.from(definition.discriminator),
      ...definition.args.map((a) => encode(a.type, args[a.name])),
    ),
    accounts: definition.accounts.map((a) => {
      const entry = accounts[a.name];
      if (!entry) throw new Error(`Missing account ${a.name}`);
      const signer = typeof entry === "string" ? undefined : entry;
      if (a.signer && !signer) throw new Error(`Missing signer ${a.name}`);
      return {
        address: signer?.address ?? (entry as Address),
        ...(signer ? { signer } : {}),
        role: a.signer
          ? a.writable
            ? AccountRole.WRITABLE_SIGNER
            : AccountRole.READONLY_SIGNER
          : a.writable
            ? AccountRole.WRITABLE
            : AccountRole.READONLY,
      };
    }),
  };
}
