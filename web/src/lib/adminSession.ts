import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Staff sessions: an httpOnly cookie holding "<expiry>.<hmac>". Server-only.
export const ADMIN_COOKIE = "slotwise_admin";
export const SESSION_SECONDS = 8 * 60 * 60;

const sha = (s: string) => createHash("sha256").update(s).digest();

export function adminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length >= 12);
}

function secret(): string {
  // An explicit secret wins; otherwise derive one so a password change also signs everyone out.
  return process.env.ADMIN_SESSION_SECRET || sha(`slotwise-admin:${process.env.ADMIN_PASSWORD}:${process.env.API_KEY}`).toString("hex");
}

const sign = (exp: string) => createHmac("sha256", secret()).update(exp).digest("base64url");

export function passwordMatches(candidate: unknown): boolean {
  if (typeof candidate !== "string" || !adminConfigured()) return false;
  return timingSafeEqual(sha(candidate), sha(process.env.ADMIN_PASSWORD!)); // constant time, equal lengths
}

export function issueSession(now = Date.now()): string {
  const exp = String(Math.floor(now / 1000) + SESSION_SECONDS);
  return `${exp}.${sign(exp)}`;
}

export function sessionValid(token: string | undefined, now = Date.now()): boolean {
  if (!token || !adminConfigured()) return false;
  const [exp, mac] = token.split(".");
  if (!exp || !mac || !/^\d+$/.test(exp)) return false;
  const want = sign(exp);
  if (mac.length !== want.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return false;
  return Number(exp) * 1000 > now;
}

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
};
