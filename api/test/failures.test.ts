// Failure paths: database errors, partial writes, races the happy-path tests never hit, and boot/shutdown.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/buildApp.js";
import { migrate, migrateWithRetry } from "../src/db.js";
import { SlidingWindowLimiter } from "../src/lib/rateLimiter.js";

const url = process.env.TEST_DATABASE_URL;
const KEY = "test-key-0123456789abcdef";
const headers = { "x-api-key": KEY };
const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Wraps a real pool so a chosen SQL statement can be made to fail or to run a hook first.
 * Everything else goes to Postgres unchanged.
 */
function faultyPool(real: pg.Pool, rule: { match: RegExp; times?: number; before?: () => Promise<void>; fail?: boolean }) {
  let left = rule.times ?? Infinity;
  const intercept = async (run: (sql: any, params?: any) => Promise<any>, sql: any, params?: any) => {
    const text = typeof sql === "string" ? sql : sql?.text;
    if (left > 0 && rule.match.test(text ?? "")) {
      left--;
      if (rule.before) await rule.before();
      if (rule.fail) throw Object.assign(new Error("simulated database failure"), { code: "08006" });
    }
    return run(sql, params);
  };
  return new Proxy(real, {
    get(target, prop) {
      if (prop === "query") return (sql: any, params?: any) => intercept((s, p) => target.query(s, p), sql, params);
      if (prop === "connect")
        return async () => {
          const client = await target.connect();
          return new Proxy(client, {
            get(c, p) {
              if (p === "query") return (sql: any, params?: any) => intercept((s, q) => c.query(s, q), sql, params);
              const v = (c as any)[p];
              return typeof v === "function" ? v.bind(c) : v;
            },
          });
        };
      const v = (target as any)[prop];
      return typeof v === "function" ? v.bind(target) : v;
    },
  }) as pg.Pool;
}

describe("configuration", () => {
  it("refuses to build with a missing or short API key", () => {
    expect(() => buildApp({ apiKey: "" })).toThrow(/at least 16/);
    expect(() => buildApp({ apiKey: "short" })).toThrow(/at least 16/);
  });
});

describe.skipIf(!url)("failure paths", () => {
  let pool: pg.Pool;
  const slots = Array.from({ length: 4 }, (_, i) => ({
    id: `f${i + 1}`,
    provider: "P",
    start: `2031-02-01T0${i}:00:00Z`,
    end: `2031-02-01T0${i}:30:00Z`,
  }));
  const app = (p: pg.Pool) => buildApp({ pool: p, apiKey: KEY, limiter: new SlidingWindowLimiter(undefined, 1000) });

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 10 });
    await migrate(pool);
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    const a = app(pool);
    await a.inject({ method: "POST", url: "/reset", headers, payload: { slots } });
    await a.close();
  });

  it("a database failure is a 500 with the error shape and no internals leaked", async () => {
    const a = app(faultyPool(pool, { match: /FROM slots s/, fail: true }));
    const r = await a.inject({ method: "GET", url: "/slots", headers });
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ error: "internal server error" });
    expect(r.body).not.toMatch(/simulated|stack|at \w+ \(/);
    await a.close();
  });

  it("healthz is 503 when the database is down", async () => {
    const a = app(faultyPool(pool, { match: /SELECT 1/, fail: true }));
    const r = await a.inject({ method: "GET", url: "/healthz" });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toEqual({ error: "db unavailable" });
    await a.close();
  });

  it("a 5xx is never stored: retrying the same Idempotency-Key after a failure books for real", async () => {
    const a = app(faultyPool(pool, { match: /INSERT INTO bookings/, times: 1, fail: true }));
    const body = { slot_id: "f1", name: "A", email: "retry@x.com" };
    const first = await a.inject({ method: "POST", url: "/bookings", headers: { ...headers, "idempotency-key": "k5xx" }, payload: body });
    expect(first.statusCode).toBe(500);
    expect((await pool.query("SELECT count(*)::int n FROM idempotency_keys")).rows[0].n).toBe(0);
    const second = await a.inject({ method: "POST", url: "/bookings", headers: { ...headers, "idempotency-key": "k5xx" }, payload: body });
    expect(second.statusCode).toBe(201);
    expect((await pool.query("SELECT count(*)::int n FROM bookings")).rows[0].n).toBe(1);
    await a.close();
  });

  it("a failed booking transaction leaves no half-written rows", async () => {
    const a = app(faultyPool(pool, { match: /INSERT INTO idempotency_keys/, times: 1, fail: true }));
    const r = await a.inject({
      method: "POST",
      url: "/bookings",
      headers: { ...headers, "idempotency-key": "half" },
      payload: { slot_id: "f2", name: "A", email: "half@x.com" },
    });
    expect(r.statusCode).toBe(500);
    // the booking insert ran but its transaction rolled back with the failed key insert
    expect((await pool.query("SELECT count(*)::int n FROM bookings")).rows[0].n).toBe(0);
    await a.close();
  });

  it("/reset is all-or-nothing: a failure part-way keeps the previous slots and bookings", async () => {
    const ok = app(pool);
    await ok.inject({ method: "POST", url: "/bookings", headers, payload: { slot_id: "f1", name: "A", email: "keep@x.com" } });
    await ok.close();
    let n = 0;
    const a = app(
      faultyPool(pool, {
        match: /INSERT INTO slots/,
        before: async () => {
          if (++n === 3) throw Object.assign(new Error("simulated"), { code: "08006" });
        },
      }),
    );
    const fresh = Array.from({ length: 5 }, (_, i) => ({ id: `n${i}`, provider: "Q", start: "2032-01-01T00:00:00Z", end: "2032-01-01T00:30:00Z" }));
    const r = await a.inject({ method: "POST", url: "/reset", headers, payload: { slots: fresh } });
    expect(r.statusCode).toBe(500);
    const ids = (await pool.query("SELECT id FROM slots ORDER BY id")).rows.map((x) => x.id);
    expect(ids).toEqual(["f1", "f2", "f3", "f4"]);
    expect((await pool.query("SELECT count(*)::int n FROM bookings")).rows[0].n).toBe(1);
    await a.close();
  });

  it("a slot deleted between lookup and insert is 404, not 500 (foreign key race)", async () => {
    const other = new pg.Pool({ connectionString: url, max: 1 });
    const a = app(
      faultyPool(pool, {
        match: /INSERT INTO bookings/,
        times: 1,
        before: async () => {
          await other.query("DELETE FROM slots WHERE id = 'f3'");
        },
      }),
    );
    const r = await a.inject({ method: "POST", url: "/bookings", headers, payload: { slot_id: "f3", name: "A", email: "fk@x.com" } });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: "slot not found" });
    await a.close();
    await other.end();
  });

  it("/reset rejects malformed slot payloads with 400 and changes nothing", async () => {
    const a = app(pool);
    const bad: unknown[] = [
      {},
      { slots: "nope" },
      { slots: [{ id: "x", provider: "P", start: "2031-01-01T00:00:00Z" }] },
      { slots: [{ id: 1, provider: "P", start: "2031-01-01T00:00:00Z", end: "2031-01-01T00:30:00Z" }] },
      { slots: [{ id: "x", provider: "P", start: "not a date", end: "2031-01-01T00:30:00Z" }] },
      { slots: [{ id: "x", provider: "P", start: "2031-01-01T01:00:00Z", end: "2031-01-01T00:30:00Z" }] },
      { slots: [null] },
    ];
    for (const payload of bad) {
      const r = await a.inject({ method: "POST", url: "/reset", headers, payload: payload as any });
      expect(r.statusCode, JSON.stringify(payload)).toBe(400);
      expect(r.json()).toHaveProperty("error");
    }
    expect((await pool.query("SELECT count(*)::int n FROM slots")).rows[0].n).toBe(4);
    await a.close();
  });

  it("a non-JSON content type on POST /bookings is a 4xx with the error shape", async () => {
    const a = app(pool);
    const r = await a.inject({ method: "POST", url: "/bookings", headers: { ...headers, "content-type": "text/plain" }, payload: "hello" });
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    expect(r.statusCode).toBeLessThan(500);
    expect(r.json()).toHaveProperty("error");
    await a.close();
  });
});

describe("migrations", () => {
  it("retries with backoff, then gives up with the real error", async () => {
    const saved = { a: process.env.DATABASE_URL, b: process.env.DATABASE_URL_UNPOOLED };
    process.env.DATABASE_URL_UNPOOLED = "postgres://nobody:x@127.0.0.1:1/none";
    const errors: string[] = [];
    const orig = console.error;
    console.error = (m: string) => errors.push(m);
    const t0 = Date.now();
    try {
      await expect(migrateWithRetry(3)).rejects.toThrow(/ECONNREFUSED/);
    } finally {
      console.error = orig;
      process.env.DATABASE_URL = saved.a;
      process.env.DATABASE_URL_UNPOOLED = saved.b;
    }
    expect(errors).toHaveLength(2); // two retries logged, third attempt throws
    expect(errors[0]).toMatch(/attempt 1\/3 failed.*retrying in 500 ms/);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1400); // 500 + 1000 ms backoff
  });

  it.skipIf(!url)("are idempotent: a second run applies nothing", async () => {
    const p = new pg.Pool({ connectionString: url, max: 1 });
    await migrate(p);
    expect(await migrate(p)).toEqual([]);
    await p.end();
  });
});

// Boots the compiled server as a real process. Requires `npm run build` first (the npm test script does it).
const dist = path.resolve(here, "../dist/server.js");
describe.skipIf(!url)("server process", () => {
  const run = (env: Record<string, string>, port: number) =>
    spawn(process.execPath, [dist], { env: { PATH: process.env.PATH ?? "", PORT: String(port), ...env }, stdio: ["ignore", "pipe", "pipe"] });

  it("exits 1 with a clear message when API_KEY is too short", async () => {
    const p = run({ DATABASE_URL: url!, API_KEY: "short" }, 3901);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    const code = await new Promise((r) => p.on("exit", r));
    expect(code).toBe(1);
    expect(err).toMatch(/API_KEY must be set and at least 16 characters/);
    expect(err).not.toContain("short"); // never echo the key
  });

  it("boots, migrates, serves on PORT with the key enforced, and exits 0 on SIGTERM", async () => {
    const port = 3902;
    const p = run({ DATABASE_URL: url!, API_KEY: KEY }, port);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    const base = `http://127.0.0.1:${port}`;
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      await new Promise((r) => setTimeout(r, 100));
      up = await fetch(`${base}/healthz`).then((r) => r.ok).catch(() => false);
    }
    expect(up).toBe(true);
    expect((await fetch(`${base}/slots`)).status).toBe(401);
    expect((await fetch(`${base}/slots`, { headers: { "x-api-key": KEY } })).status).toBe(200);
    p.kill("SIGTERM");
    const code = await new Promise((r) => p.on("exit", r));
    expect(code).toBe(0);
    expect(out).toMatch(/SIGTERM received, shutting down/);
  });
});
