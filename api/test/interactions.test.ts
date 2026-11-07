// Cases where Levels 3, 4 and 5 meet: concurrency, idempotency and rate limiting together.
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/buildApp.js";
import { migrate } from "../src/db.js";
import { SlidingWindowLimiter } from "../src/lib/rateLimiter.js";

const url = process.env.TEST_DATABASE_URL;
const KEY = "test-key-0123456789abcdef";

describe.skipIf(!url)("levels 3 to 5 together", () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildApp>;
  let strict: ReturnType<typeof buildApp>; // real 5-per-minute limiter
  const headers = { "x-api-key": KEY };
  const slots = Array.from({ length: 12 }, (_, i) => ({
    id: `s${i + 1}`,
    provider: "P",
    start: new Date(Date.UTC(2031, 0, 1, 0, i * 30)).toISOString(),
    end: new Date(Date.UTC(2031, 0, 1, 0, i * 30 + 30)).toISOString(),
  }));
  const post = (a: ReturnType<typeof buildApp>, payload: any, extra: Record<string, string> = {}) =>
    a.inject({ method: "POST", url: "/bookings", headers: { ...headers, ...extra }, payload });
  const confirmedFor = async (slot: string) =>
    (await pool.query("SELECT count(*)::int n FROM bookings WHERE slot_id=$1 AND status='confirmed'", [slot])).rows[0].n as number;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 30 });
    await migrate(pool);
    app = buildApp({ pool, apiKey: KEY, limiter: new SlidingWindowLimiter(undefined, 1000) });
    strict = buildApp({ pool, apiKey: KEY });
  });
  afterAll(async () => {
    await app.close();
    await strict.close();
    await pool.end();
  });
  beforeEach(async () => {
    await strict.inject({ method: "POST", url: "/reset", headers, payload: { slots } });
    await app.inject({ method: "POST", url: "/reset", headers, payload: { slots } });
  });

  it("10 concurrent requests, each with its own key, for one slot: one 201, nine 409, and each replays its own answer", async () => {
    const res = await Promise.all(
      Array.from({ length: 10 }, (_, i) => post(app, { slot_id: "s1", name: "N", email: `k${i}@x.com` }, { "idempotency-key": `key-${i}` })),
    );
    const codes = res.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(9);
    expect(await confirmedFor("s1")).toBe(1);
    const again = await Promise.all(
      Array.from({ length: 10 }, (_, i) => post(app, { slot_id: "s1", name: "N", email: `k${i}@x.com` }, { "idempotency-key": `key-${i}` })),
    );
    expect(again.map((r) => r.statusCode)).toEqual(codes);
    expect(again.map((r) => r.body)).toEqual(res.map((r) => r.body));
  });

  it("concurrent same key with two different bodies: one booking, the other request is 422", async () => {
    const res = await Promise.all([
      post(app, { slot_id: "s2", name: "A", email: "a@x.com" }, { "idempotency-key": "split" }),
      post(app, { slot_id: "s3", name: "A", email: "a@x.com" }, { "idempotency-key": "split" }),
    ]);
    expect(res.map((r) => r.statusCode).sort()).toEqual([201, 422]);
    expect((await pool.query("SELECT count(*)::int n FROM bookings")).rows[0].n).toBe(1);
  });

  it("a stored 201 replays as 201 even after the booking was cancelled (the replay is the original answer)", async () => {
    const body = { slot_id: "s4", name: "A", email: "c@x.com" };
    const first = await post(app, body, { "idempotency-key": "after-cancel" });
    await app.inject({ method: "DELETE", url: `/bookings/${first.json().id}`, headers });
    const replay = await post(app, body, { "idempotency-key": "after-cancel" });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(await confirmedFor("s4")).toBe(0); // the replay did not re-book
  });

  it("cancel racing a rebook on the same slot never leaves two confirmed bookings", async () => {
    for (let round = 0; round < 5; round++) {
      const b = await post(app, { slot_id: "s5", name: "A", email: `r${round}@x.com` });
      expect(b.statusCode).toBe(201);
      const [, ...rebooks] = await Promise.all([
        app.inject({ method: "DELETE", url: `/bookings/${b.json().id}`, headers }),
        ...Array.from({ length: 5 }, (_, i) => post(app, { slot_id: "s5", name: "B", email: `rb${round}${i}@x.com` })),
      ]);
      expect(await confirmedFor("s5")).toBeLessThanOrEqual(1);
      // whoever won, clean up so the next round starts from a free slot
      for (const r of rebooks) if (r.statusCode === 201) await app.inject({ method: "DELETE", url: `/bookings/${r.json().id}`, headers });
    }
  });

  it("concurrent bookings racing a /reset end in 201 or 404, never 500", async () => {
    const res = await Promise.all([
      ...Array.from({ length: 8 }, (_, i) => post(app, { slot_id: `s${i + 1}`, name: "A", email: `z${i}@x.com` })),
      app.inject({ method: "POST", url: "/reset", headers, payload: { slots: [] } }),
    ]);
    for (const r of res.slice(0, 8)) expect([201, 404]).toContain(r.statusCode);
  });

  it("with the real limiter: 20 concurrent requests for one email with 20 different keys give exactly 5 non-429, and no 429 is stored", async () => {
    const res = await Promise.all(
      Array.from({ length: 20 }, (_, i) => post(strict, { slot_id: `s${(i % 10) + 1}`, name: "A", email: "burst@x.com" }, { "idempotency-key": `b${i}` })),
    );
    expect(res.filter((r) => r.statusCode !== 429)).toHaveLength(5);
    for (const r of res.filter((r) => r.statusCode === 429)) expect(r.headers["retry-after"]).toMatch(/^[1-9][0-9]*$/);
    const stored = (await pool.query("SELECT status_code FROM idempotency_keys")).rows.map((r) => r.status_code);
    expect(stored).toHaveLength(5);
    expect(stored).not.toContain(429);
  });

  it("pagination cursors are bound to the email and cannot be edited", async () => {
    for (let i = 0; i < 3; i++) await post(app, { slot_id: `s${i + 1}`, name: "A", email: "p@x.com" });
    for (let i = 3; i < 6; i++) await post(app, { slot_id: `s${i + 1}`, name: "A", email: "q@x.com" });
    const page = (await app.inject({ method: "GET", url: "/bookings?email=p@x.com&limit=1", headers })).json();
    expect(page.next_cursor).toEqual(expect.any(String));
    const ok = await app.inject({ method: "GET", url: `/bookings?email=P@X.COM&limit=1&cursor=${page.next_cursor}`, headers });
    expect(ok.statusCode).toBe(200); // same email, different case
    const other = await app.inject({ method: "GET", url: `/bookings?email=q@x.com&cursor=${page.next_cursor}`, headers });
    expect(other.statusCode).toBe(400);
    const [seq, mac] = Buffer.from(page.next_cursor, "base64url").toString().split(".");
    const edited = Buffer.from(`${Number(seq) + 1}.${mac}`).toString("base64url");
    expect((await app.inject({ method: "GET", url: `/bookings?email=p@x.com&cursor=${edited}`, headers })).statusCode).toBe(400);
  });
});
