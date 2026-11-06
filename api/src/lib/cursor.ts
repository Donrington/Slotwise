import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "./errors.js";

/**
 * Opaque pagination cursor: base64url("<seq>.<mac>"), where mac is an HMAC over the email and seq.
 * A cursor that was edited, truncated, or taken from another email's listing fails the check (400),
 * so a client cannot jump to an arbitrary position or reuse a cursor across people.
 */
export interface CursorCodec {
  encode(email: string, seq: string | number | bigint): string;
  decode(email: string, cursor: string): string;
}

export function cursorCodec(secret: string): CursorCodec {
  const mac = (email: string, seq: string) =>
    createHmac("sha256", secret).update(`${email}\n${seq}`).digest("base64url").slice(0, 22);

  return {
    encode(email, seq) {
      const s = String(seq);
      return Buffer.from(`${s}.${mac(email, s)}`, "utf8").toString("base64url");
    },
    decode(email, cursor) {
      const bad = () => new HttpError(400, "invalid cursor");
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(cursor)) throw bad();
      const m = /^([1-9][0-9]{0,18})\.([A-Za-z0-9_-]{22})$/.exec(Buffer.from(cursor, "base64url").toString("utf8"));
      if (!m) throw bad();
      const [, seq, got] = m as unknown as [string, string, string];
      const want = mac(email, seq);
      if (!timingSafeEqual(Buffer.from(got), Buffer.from(want))) throw bad();
      return seq;
    },
  };
}

export function parseLimit(raw: unknown): number {
  if (raw === undefined) return 10;
  if (typeof raw !== "string" || !/^[0-9]+$/.test(raw)) throw limitError();
  const n = Number(raw);
  if (n < 1 || n > 50) throw limitError();
  return n;
}
const limitError = () => new HttpError(400, "limit must be an integer between 1 and 50");
