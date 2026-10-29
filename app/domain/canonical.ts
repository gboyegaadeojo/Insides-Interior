// Canonical JSON for content hashes (SPEC 8.1 `content_hash`, FR-QT-10): object
// keys sorted, undefined dropped, so the same document always hashes the same
// however its object was built.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json | undefined };

export function canonicalJson(value: Json | undefined): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value))
      throw new Error("Can't hash a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}
