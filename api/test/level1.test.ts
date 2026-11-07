import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/buildApp.js";
import { migrate } from "../src/db.js";

const url = process.env.TEST_DATABASE_URL;
const KEY = "test-key-0123456789abcdef";
if (!url) console.warn("TEST_DATABASE_URL not set: skipping integration tests");

describe.skipIf(!url)("level 1", () => {
  let pool: pg.Pool;
  let rawApp: ReturnType<typeof buildApp>;
  const app = { inject: (o: any) => rawApp.inject({ ...o, headers: { "x-api-key": KEY, ...(o.headers ?? {}) } }), close: () => rawApp?.close() };
  const slots = [
    { id: "b", provider: "Dr Bisi", start: "2030-01-01T10:00:00Z", end: "2030-01-01T10:30:00Z" },
    { id: "a", provider: "Dr Ade", start: "2030-01-01T09:00:00+01:00", end: "2030-01-01T09:30:00+01:00" },
    { id: "c", provider: "Dr Ade", start: "2030-01-01T11:00:00.5Z", end: "2030-01-01T11:30:00Z" },
  ];
  const reset = () => app.inject({ method: "POST", url: "/reset", payload: { slots } });

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await migrate(pool);
    rawApp = buildApp({ pool, apiKey: KEY });
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });
  beforeEach(async () => {
    await reset();
  });

  it("lists slots earliest first with start/end unchanged", async () => {
    const res = await app.inject({ method: "GET", url: "/slots" });
    expect(res.statusCode).toBe(200);
    const list = res.json().slots;
    expect(list.map((s: any) => s.id)).toEqual(["a", "b", "c"]);
    expect(list[0].start).toBe("2030-01-01T09:00:00+01:00");
    expect(list[2].start).toBe("2030-01-01T11:00:00.5Z");
    expect(list.every((s: any) => s.available === true)).toBe(true);
  });

  it("filters by provider", async () => {
    const res = await app.inject({ method: "GET", url: "/slots?provider=Dr%20Ade" });
    expect(res.json().slots.map((s: any) => s.id)).toEqual(["a", "c"]);
  });

  it("flips available after booking and round-trips the booking", async () => {
    const post = await app.inject({
      method: "POST",
      url: "/bookings",
      payload: { slot_id: "a", name: "Ann", email: "ann@x.com" },
    });
    expect(post.statusCode).toBe(201);
    const booking = post.json();
    expect(booking.status).toBe("confirmed");
    const list = (await app.inject({ method: "GET", url: "/slots" })).json().slots;
    expect(list.find((s: any) => s.id === "a").available).toBe(false);
    const got = await app.inject({ method: "GET", url: `/bookings/${booking.id}` });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toEqual(booking);
  });

  it("returns 404s in the error shape", async () => {
    const r1 = await app.inject({ method: "POST", url: "/bookings", payload: { slot_id: "zzz", name: "A", email: "a@x.com" } });
    expect(r1.statusCode).toBe(404);
    expect(r1.json()).toEqual({ error: "slot not found" });
    const r2 = await app.inject({ method: "GET", url: "/bookings/not-a-uuid" });
    expect(r2.statusCode).toBe(404);
    const r3 = await app.inject({ method: "GET", url: "/bookings/00000000-0000-0000-0000-000000000000" });
    expect(r3.json()).toEqual({ error: "booking not found" });
    const r4 = await app.inject({ method: "GET", url: "/nope" });
    expect(r4.statusCode).toBe(404);
    expect(r4.json()).toHaveProperty("error");
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await app.inject({ method: "POST", url: "/bookings", headers: { "content-type": "application/json" }, payload: "{bad" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty("error");
  });

  it("reset rejects duplicate ids and accepts an empty array", async () => {
    const dup = await app.inject({ method: "POST", url: "/reset", payload: { slots: [slots[0], slots[0]] } });
    expect(dup.statusCode).toBe(400);
    const empty = await app.inject({ method: "POST", url: "/reset", payload: { slots: [] } });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ ok: true, slots: 0 });
  });
});
