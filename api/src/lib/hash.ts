import { createHash } from "node:crypto";

/**
 * sha256 of the request after normalisation (trimmed name, lower-cased email,
 * trimmed slot_id, keys sorted), so key order and whitespace do not matter.
 * Works on invalid bodies too, so their 400 can be replayed.
 */
export function requestHash(body: unknown): string {
  return createHash("sha256").update(canonical(body)).digest("hex");
}

function canonical(v: unknown): string {
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) {
      const x = o[k];
      out[k] = typeof x === "string" ? (k === "email" ? x.trim().toLowerCase() : x.trim()) : x;
    }
    return JSON.stringify(out);
  }
  return JSON.stringify(v ?? null);
}
