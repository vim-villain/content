import { createHash } from "node:crypto";

/**
 * Canonical JSON: object keys sorted by code unit, no whitespace, arrays in
 * order, integers only. See ARCHITECTURE.md §5.4.
 */
export function canonicalJson(value: unknown): string {
  return stringify(value);
}

function stringify(value: unknown): string {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isInteger(value)) {
        throw new Error(`canonical JSON forbids non-integer number ${value}`);
      }
      return String(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item) => stringify(item)).join(",")}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      const entries = keys.map(
        (key) => `${JSON.stringify(key)}:${stringify(record[key])}`,
      );
      return `{${entries.join(",")}}`;
    }
    default:
      throw new Error(`canonical JSON forbids ${typeof value}`);
  }
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Pretty fixture form: 2-space JSON with a trailing newline. */
export function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
