import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db.js";
import { SlidingWindowLimiter } from "../src/lib/rateLimiter.js";

const url = process.env.TEST_DATABASE_URL;
const KEY = "test-key-0123456789abcdef";

describe.skipIf(!url)("level 2", () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildApp>;
  const auth = { "x-api-key": KEY };
  const fixed = new Date("2030-06-01T12:00:00Z");

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await migrate(pool);
    app = buildApp({ pool, apiKey: KEY, clock: { now: () => fixed }, limiter: new SlidingWindowLimiter(undefined, 1000) });
    await app.inject({
      method: "POST",
      url: "/reset",
      headers: auth,
      payload: {
        slots: [
          { id: "past", provider: "P", start: "2030-06-01T11:00:00Z", end: "2030-06-01T11:30:00Z" },
          { id: "now", provider: "P", start: "2030-06-01T12:00:00Z", end: "2030-06-01T12:30:00Z" },
          { id: "next", provider: "P", start: "2030-06-01T12:00:01Z", end: "2030-06-01T12:30:00Z" },
        ],
      },
    });
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  const routes: [string, string, unknown?][] = [
    ["POST", "/reset", { slots: [] }],
    ["GET", "/slots"],
    ["POST", "/bookings", {}],
    ["GET", "/bookings/00000000-0000-0000-0000-000000000000"],
    ["GET", "/nope"],
  ];

  it("401 without or with the wrong key on every route, 401 for unknown paths", async () => {
    for (const [method, u, payload] of routes) {
      for (const headers of [{}, { "x-api-key": "wrong" }, { "x-api-key": KEY + "x" }]) {
        const r = await app.inject({ method: method as any, url: u, headers, payload: payload as any });
        expect(r.statusCode, `${method} ${u}`).toBe(401);
        expect(r.json()).toEqual({ error: "unauthorized" });
      }
    }
  });

  it("healthz needs no key", async () => {
    const r = await app.inject({ method: "GET", url: "/healthz" });
    expect(r.statusCode).toBe(200);
  });

  it("OPTIONS preflight is 204 without a key, with CORS headers", async () => {
    const r = await app.inject({ method: "OPTIONS", url: "/bookings", headers: { origin: "https://x.dev" } });
    expect(r.statusCode).toBe(204);
    expect(r.headers["access-control-allow-origin"]).toBe("*");
    expect(r.headers["access-control-allow-headers"]).toMatch(/X-API-Key.*Idempotency-Key/i);
    expect(r.headers["access-control-allow-methods"]).toMatch(/DELETE/);
  });

  it("correct key works and exposes CORS headers", async () => {
    const r = await app.inject({ method: "GET", url: "/slots", headers: auth });
    expect(r.statusCode).toBe(200);
    expect(r.headers["access-control-expose-headers"]).toMatch(/Retry-After/);
  });

  const book = (payload: unknown) => app.inject({ method: "POST", url: "/bookings", headers: auth, payload: payload as any });

  it("400 variants", async () => {
    for (const p of [{}, { slot_id: "next", name: "", email: "a@x.com" }, { slot_id: "next", name: "A", email: "a@b" }, { slot_id: 1, name: "A", email: "a@x.com" }]) {
      const r = await book(p);
      expect(r.statusCode).toBe(400);
      expect(r.json()).toHaveProperty("error");
    }
  });

  it("404 for unknown slot", async () => {
    const r = await book({ slot_id: "ghost", name: "A", email: "a@x.com" });
    expect(r.statusCode).toBe(404);
  });

  it("400 for a started slot (past and exactly now), and validation comes before lookup", async () => {
    for (const id of ["past", "now"]) {
      const r = await book({ slot_id: id, name: "A", email: "a@x.com" });
      expect(r.statusCode).toBe(400);
      expect(r.json()).toEqual({ error: "slot has already started" });
    }
    const r = await book({ slot_id: "ghost", name: "", email: "a@x.com" });
    expect(r.statusCode).toBe(400);
  });

  it("normalises name and email in the response", async () => {
    const r = await book({ slot_id: "next", name: "  Ann Lee ", email: "  Ann@X.COM " });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ name: "Ann Lee", email: "ann@x.com", status: "confirmed" });
  });
});
