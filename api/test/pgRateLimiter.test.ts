// The production limiter: a sliding window in Postgres, exact across instances.
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/buildApp.js";
import { migrate } from "../src/db.js";
import { PgRateLimiter } from "../src/lib/rateLimiter.js";

const url = process.env.TEST_DATABASE_URL;
const KEY = "test-key-0123456789abcdef";

describe.skipIf(!url)("PgRateLimiter", () => {
  let pool: pg.Pool;
  let limiter: PgRateLimiter;
  const backdate = (email: string, secondsAgo: number[]) =>
    Promise.all(secondsAgo.map((s) => pool.query("INSERT INTO rate_limit_attempts (email, at) VALUES ($1, clock_timestamp() - make_interval(secs => $2))", [email, s])));

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 30 });
    await migrate(pool);
    limiter = new PgRateLimiter(pool);
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await limiter.clear();
  });

  it("allows 5 then blocks the 6th with Retry-After of about the window", async () => {
    for (let i = 0; i < 5; i++) expect(await limiter.consume("a@x.com")).toEqual({ allowed: true });
    const r = await limiter.consume("a@x.com");
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.retryAfterSeconds).toBeGreaterThanOrEqual(59);
    expect((await pool.query("SELECT count(*)::int n FROM rate_limit_attempts")).rows[0].n).toBe(5); // blocked one not recorded
  });

  it("computes Retry-After from the oldest attempt in the window", async () => {
    await backdate("b@x.com", [50, 40, 30, 20, 10]);
    const r = await limiter.consume("b@x.com");
    expect(r).toEqual({ allowed: false, retryAfterSeconds: 10 });
  });

  it("slides: attempts older than 60 s no longer count, and are pruned", async () => {
    await backdate("c@x.com", [61, 70, 80, 90, 100]);
    expect(await limiter.consume("c@x.com")).toEqual({ allowed: true });
    expect((await pool.query("SELECT count(*)::int n FROM rate_limit_attempts WHERE email='c@x.com'")).rows[0].n).toBe(1);
  });

  it("keeps emails independent", async () => {
    for (let i = 0; i < 6; i++) await limiter.consume("d@x.com");
    expect(await limiter.consume("e@x.com")).toEqual({ allowed: true });
  });

  it("50 simultaneous attempts for one email allow exactly 5", async () => {
    const res = await Promise.all(Array.from({ length: 50 }, () => limiter.consume("burst@x.com")));
    expect(res.filter((r) => r.allowed)).toHaveLength(5);
  });

  it("is exact across separate app instances sharing one database (as on Vercel)", async () => {
    const slots = Array.from({ length: 12 }, (_, i) => ({
      id: `r${i}`,
      provider: "P",
      start: new Date(Date.UTC(2031, 3, 1, i)).toISOString(),
      end: new Date(Date.UTC(2031, 3, 1, i, 30)).toISOString(),
    }));
    // two instances, two pools: nothing shared in memory
    const poolB = new pg.Pool({ connectionString: url, max: 15 });
    const a = buildApp({ pool, apiKey: KEY });
    const b = buildApp({ pool: poolB, apiKey: KEY });
    await a.inject({ method: "POST", url: "/reset", headers: { "x-api-key": KEY }, payload: { slots } });
    const post = (app: typeof a, i: number) =>
      app.inject({ method: "POST", url: "/bookings", headers: { "x-api-key": KEY }, payload: { slot_id: `r${i % 12}`, name: "A", email: "multi@x.com" } });
    const res = await Promise.all(Array.from({ length: 24 }, (_, i) => post(i % 2 ? a : b, i)));
    expect(res.filter((r) => r.statusCode !== 429)).toHaveLength(5);
    for (const r of res.filter((r) => r.statusCode === 429)) expect(r.headers["retry-after"]).toMatch(/^[1-9][0-9]*$/);
    // /reset on one instance clears the shared counter for both
    await b.inject({ method: "POST", url: "/reset", headers: { "x-api-key": KEY }, payload: { slots } });
    expect((await post(a, 0)).statusCode).toBe(201);
    await a.close();
    await b.close();
    await poolB.end();
  });

  it("an attempt inside a transaction that rolls back is not counted", async () => {
    const client = await pool.connect();
    await client.query("BEGIN");
    expect(await limiter.consume("tx@x.com", client)).toEqual({ allowed: true });
    await client.query("ROLLBACK");
    client.release();
    expect((await pool.query("SELECT count(*)::int n FROM rate_limit_attempts WHERE email='tx@x.com'")).rows[0].n).toBe(0);
  });
});
