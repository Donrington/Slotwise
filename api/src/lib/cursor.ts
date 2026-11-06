import { HttpError } from "./errors.js";

export const encodeCursor = (seq: string | number | bigint): string =>
  Buffer.from(`seq:${seq}`, "utf8").toString("base64url");

export function decodeCursor(cursor: string): string {
  const bad = () => new HttpError(400, "invalid cursor");
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw bad();
  const text = Buffer.from(cursor, "base64url").toString("utf8");
  const m = /^seq:([1-9][0-9]{0,18})$/.exec(text);
  if (!m) throw bad();
  if (encodeCursor(m[1]!) !== cursor) throw bad(); // reject non-canonical encodings
  return m[1]!;
}

export function parseLimit(raw: unknown): number {
  if (raw === undefined) return 10;
  if (typeof raw !== "string" || !/^[0-9]+$/.test(raw)) throw limitError();
  const n = Number(raw);
  if (n < 1 || n > 50) throw limitError();
  return n;
}
const limitError = () => new HttpError(400, "limit must be an integer between 1 and 50");
