import { createHash, timingSafeEqual } from "node:crypto";

const sha = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time comparison; hashing first makes the buffers equal length. */
export function keysMatch(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string") return false;
  return timingSafeEqual(sha(provided), sha(expected));
}

export function assertApiKey(key: string | undefined): string {
  if (!key || key.length < 16) {
    throw new Error("API_KEY must be set and at least 16 characters long");
  }
  return key;
}
