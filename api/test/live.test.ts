import pg from "pg";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { databaseName, liveSlotsFromEnv } from "../src/services/live.js";

const KEY = "test-key-0123456789abcdef";
const url = process.env.TEST_DATABASE_URL;

describe("live slots", () => {
  it("reads the database name from DATABASE_URL", () => {
    expect(databaseName("postgresql://u:p@ep-x-pooler.c-9.us-east-2.aws.neon.tech/neondb?sslmode=require")).toBe("neondb");
  });
  it("is off unless secret, url and database are all set", () => {
    expect(liveSlotsFromEnv({})).toBeUndefined();
    expect(liveSlotsFromEnv({ NEON_REALTIME_URL: "wss://x", DATABASE_URL: "postgres://h/db" })).toBeUndefined();
  });
  it.skipIf(!url)("POST /slots/live is 503 when not configured and 401 without a key", async () => {
    const pool = new pg.Pool({ connectionString: url });
    const app = buildApp({ pool, apiKey: KEY });
    expect((await app.inject({ method: "POST", url: "/slots/live" })).statusCode).toBe(401);
    const r = await app.inject({ method: "POST", url: "/slots/live", headers: { "x-api-key": KEY } });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toEqual({ error: "realtime not configured" });
    await app.close();
    await pool.end();
  });
  it.skipIf(!url)("POST /slots/live returns the url and whatever the sealer produced", async () => {
    const pool = new pg.Pool({ connectionString: url });
    const app = buildApp({ pool, apiKey: KEY, live: { url: "wss://rt.example", seal: async () => ({ capability: "c", expiresAt: 1 }) } });
    const r = await app.inject({ method: "POST", url: "/slots/live", headers: { "x-api-key": KEY } });
    expect(r.json()).toEqual({ url: "wss://rt.example", sealed: { capability: "c", expiresAt: 1 } });
    await app.close();
    await pool.end();
  });
});

// Uses the real Neon secret when present (from `neon env pull`). Sealing is local encryption, no network.
const secret = process.env.NEON_REALTIME_SECRET;
describe.skipIf(!secret)("live slots with the real Neon Realtime secret", () => {
  it("seals the slots query into a short-lived capability", async () => {
    const live = liveSlotsFromEnv(process.env)!;
    expect(live).toBeDefined();
    const sealed = (await live.seal()) as { capability: string; queryFingerprint: string; expiresAt: number };
    expect(typeof sealed.capability).toBe("string");
    expect(sealed.capability.split(".")).toHaveLength(5); // compact JWE
    expect(sealed.capability).not.toContain("SELECT"); // the SQL is encrypted, not readable by the client
    expect(typeof sealed.queryFingerprint).toBe("string");
    expect(sealed.expiresAt).toBeGreaterThan(Date.now());
    const again = (await live.seal()) as { queryFingerprint: string };
    expect(again.queryFingerprint).toBe(sealed.queryFingerprint); // same query, renewable
  });
});
