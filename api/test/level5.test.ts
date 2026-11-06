import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db.js";

const url = process.env.TEST_DATABASE_URL;
const KEY = "test-key-0123456789abcdef";

describe.skipIf(!url)("level 5", () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildApp>;
  const headers = { "x-api-key": KEY };
  const slots = Array.from({ length: 30 }, (_, i) => ({
    id: `s${i + 1}`,
    provider: "P",
    start: new Date(Date.UTC(2031, 0, 1, 0, i * 30)).toISOString(),
    end: new Date(Date.UTC(2031, 0, 1, 0, i * 30 + 30)).toISOString(),
  }));
  const book = (payload: any, extra: Record<string, string> = {}) =>
    app.inject({ method: "POST", url: "/bookings", headers: { ...headers, ...extra }, payload });
  const reset = () => app.inject({ method: "POST", url: "/reset", headers, payload: { slots } });

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 20 });
    await migrate(pool);
    app = buildApp({ pool, apiKey: KEY });
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });
  beforeEach(async () => {
    await reset();
  });

  it("6th attempt for one email is 429 with integer Retry-After, even when earlier ones failed", async () => {
    const codes: number[] = [];
    codes.push((await book({ slot_id: "nope", name: "A", email: "z@x.com" })).statusCode); // 404
    codes.push((await book({ slot_id: "s1", name: "", email: "z@x.com" })).statusCode); // 400
    codes.push((await book({ slot_id: "s1", name: "A", email: "Z@x.com" })).statusCode); // 201
    codes.push((await book({ slot_id: "s1", name: "A", email: "z@x.com" })).statusCode); // 409
    codes.push((await book({ slot_id: "s2", name: "A", email: " z@x.com " })).statusCode); // 201
    expect(codes).toEqual([404, 400, 201, 409, 201]);
    const sixth = await book({ slot_id: "s3", name: "A", email: "z@x.com" });
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json()).toEqual({ error: "too many attempts, retry later" });
    expect(sixth.headers["retry-after"]).toMatch(/^[1-9][0-9]*$/);
    expect((await book({ slot_id: "s3", name: "A", email: "other@x.com" })).statusCode).toBe(201);
  });

  it("after /reset the first email works again", async () => {
    for (let i = 0; i < 5; i++) await book({ slot_id: "s1", name: "A", email: "r@x.com" });
    expect((await book({ slot_id: "s2", name: "A", email: "r@x.com" })).statusCode).toBe(429);
    await reset();
    expect((await book({ slot_id: "s2", name: "A", email: "r@x.com" })).statusCode).toBe(201);
  });

  it("20 concurrent requests for one email: exactly 5 pass, 15 are 429", async () => {
    const res = await Promise.all(Array.from({ length: 20 }, (_, i) => book({ slot_id: `s${i + 1}`, name: "A", email: "c@x.com" })));
    const codes = res.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 429)).toHaveLength(15);
    expect(codes.filter((c) => c !== 429)).toHaveLength(5);
  });

  it("idempotent replays do not consume attempts, and 429 is never stored", async () => {
    const body = { slot_id: "s1", name: "A", email: "i@x.com" };
    const first = await book(body, { "idempotency-key": "ik" });
    expect(first.statusCode).toBe(201);
    for (let i = 0; i < 10; i++) {
      const r = await book(body, { "idempotency-key": "ik" });
      expect(r.statusCode).toBe(201);
      expect(r.json().id).toBe(first.json().id);
    }
    // 4 more fresh attempts are still allowed (only 1 counted so far)
    for (let i = 0; i < 4; i++) expect((await book({ slot_id: `s${i + 2}`, name: "A", email: "i@x.com" })).statusCode).toBe(201);
    const blocked = await book({ slot_id: "s9", name: "A", email: "i@x.com" }, { "idempotency-key": "ik2" });
    expect(blocked.statusCode).toBe(429);
    const stored = await pool.query("SELECT 1 FROM idempotency_keys WHERE key = 'ik2'");
    expect(stored.rowCount).toBe(0);
  });

  it("bodies without a usable email are not rate limited", async () => {
    for (let i = 0; i < 8; i++) expect((await book({ slot_id: "s1", name: "A" })).statusCode).toBe(400);
  });
});
