import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/buildApp.js";
import { migrate } from "../src/db.js";
import { SlidingWindowLimiter } from "../src/lib/rateLimiter.js";

const url = process.env.TEST_DATABASE_URL;
const KEY = "test-key-0123456789abcdef";
const headers = { "x-api-key": KEY };
const slot = (id: string, hour: number, provider = "Dr A") => ({
  id,
  provider,
  start: `2031-05-01T${String(hour).padStart(2, "0")}:00:00Z`,
  end: `2031-05-01T${String(hour).padStart(2, "0")}:30:00Z`,
});

describe.skipIf(!url)("admin routes", () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildApp>;
  const req = (method: string, path: string, payload?: unknown) => app.inject({ method: method as any, url: path, headers, payload: payload as any });
  const book = (slot_id: string, email: string) => req("POST", "/bookings", { slot_id, name: "Pat", email });

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 10 });
    await migrate(pool);
    app = buildApp({ pool, apiKey: KEY, limiter: new SlidingWindowLimiter(undefined, 1000) });
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });
  beforeEach(async () => {
    await req("POST", "/reset", { slots: [slot("a", 9), slot("b", 10, "Dr B")] });
  });

  it("every admin route needs the API key", async () => {
    for (const [m, p] of [["GET", "/admin/overview"], ["GET", "/admin/slots"], ["POST", "/admin/slots"], ["DELETE", "/admin/slots/a"], ["GET", "/admin/bookings"]]) {
      expect((await app.inject({ method: m as any, url: p })).statusCode, `${m} ${p}`).toBe(401);
    }
  });

  it("adds slots without touching existing slots or bookings", async () => {
    const b = await book("a", "keep@x.com");
    const r = await req("POST", "/admin/slots", { slots: [slot("c", 11), slot("d", 12)] });
    expect(r.statusCode).toBe(201);
    expect(r.json().added).toBe(2);
    const list = (await req("GET", "/slots")).json().slots.map((s: any) => s.id);
    expect(list).toEqual(["a", "b", "c", "d"]);
    expect((await req("GET", `/bookings/${b.json().id}`)).json().status).toBe("confirmed");
  });

  it("keeps start and end exactly as sent", async () => {
    await req("POST", "/admin/slots", { slots: [{ id: "tz", provider: "Dr A", start: "2031-05-02T09:00:00+01:00", end: "2031-05-02T09:30:00+01:00" }] });
    const s = (await req("GET", "/slots")).json().slots.find((x: any) => x.id === "tz");
    expect([s.start, s.end]).toEqual(["2031-05-02T09:00:00+01:00", "2031-05-02T09:30:00+01:00"]);
  });

  it("is all-or-nothing: one existing id rejects the whole batch with 409", async () => {
    const r = await req("POST", "/admin/slots", { slots: [slot("new1", 13), slot("a", 14)] });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/already exists: a/);
    expect((await req("GET", "/slots")).json().slots.map((s: any) => s.id)).toEqual(["a", "b"]);
  });

  it("validates like /reset, plus empty ids, providers and batch size", async () => {
    for (const payload of [
      {},
      { slots: [] },
      { slots: [{ ...slot("x", 9), end: "2031-05-01T08:00:00Z" }] },
      { slots: [slot("dup", 9), slot("dup", 10)] },
      { slots: [{ ...slot("x", 9), id: "  " }] },
      { slots: [{ ...slot("x", 9), provider: "" }] },
      { slots: Array.from({ length: 501 }, (_, i) => slot(`n${i}`, 9)) },
    ]) {
      const r = await req("POST", "/admin/slots", payload);
      expect(r.statusCode, JSON.stringify(payload).slice(0, 80)).toBe(400);
      expect(r.json()).toHaveProperty("error");
    }
  });

  it("deletes an open slot; refuses a booked one until it is cancelled; 404 for unknown", async () => {
    expect((await req("DELETE", "/admin/slots/b")).json()).toEqual({ deleted: "b" });
    const bk = await book("a", "held@x.com");
    const held = await req("DELETE", "/admin/slots/a");
    expect(held.statusCode).toBe(409);
    expect(held.json()).toEqual({ error: "slot has a confirmed booking; cancel it first" });
    await req("DELETE", `/bookings/${bk.json().id}`);
    expect((await req("DELETE", "/admin/slots/a")).statusCode).toBe(200);
    expect((await req("DELETE", "/admin/slots/a")).statusCode).toBe(404);
    expect((await req("GET", "/slots")).json().slots).toEqual([]);
  });

  it("a delete racing bookings never leaves a booking on a missing slot, and never 500s", async () => {
    const res = await Promise.all([
      req("DELETE", "/admin/slots/a"),
      ...Array.from({ length: 6 }, (_, i) => book("a", `race${i}@x.com`)),
    ]);
    for (const r of res) expect(r.statusCode).toBeLessThan(500);
    const orphans = await pool.query("SELECT count(*)::int n FROM bookings b LEFT JOIN slots s ON s.id = b.slot_id WHERE s.id IS NULL");
    expect(orphans.rows[0].n).toBe(0);
    const del = res[0].statusCode;
    expect([200, 409]).toContain(del); // either it was deleted first, or a booking won and holds it
  });

  it("lists every slot with who holds it", async () => {
    await book("a", "Holder@X.com");
    const slots = (await req("GET", "/admin/slots")).json().slots;
    expect(slots[0]).toMatchObject({ id: "a", available: false, booking: { name: "Pat", email: "holder@x.com" } });
    expect(slots[1]).toMatchObject({ id: "b", available: true, booking: null });
  });

  it("lists all bookings newest first, filters by status, and pages with a cursor tied to the filter", async () => {
    await req("POST", "/admin/slots", { slots: [slot("c", 11), slot("d", 12), slot("e", 13)] });
    const ids: string[] = [];
    for (const [s, e] of [["a", "p1@x.com"], ["b", "p2@x.com"], ["c", "p3@x.com"], ["d", "p4@x.com"], ["e", "p5@x.com"]]) ids.push((await book(s!, e!)).json().id);
    await req("DELETE", `/bookings/${ids[1]}`);
    const p1 = (await req("GET", "/admin/bookings?limit=2")).json();
    expect(p1.bookings.map((b: any) => b.id)).toEqual([ids[4], ids[3]]);
    expect(p1.bookings[0].slot).toEqual({ provider: "Dr A", start: "2031-05-01T13:00:00Z", end: "2031-05-01T13:30:00Z" });
    const p2 = (await req("GET", `/admin/bookings?limit=2&cursor=${p1.next_cursor}`)).json();
    const p3 = (await req("GET", `/admin/bookings?limit=2&cursor=${p2.next_cursor}`)).json();
    expect([...p1.bookings, ...p2.bookings, ...p3.bookings].map((b: any) => b.id)).toEqual([...ids].reverse());
    expect(p3.next_cursor).toBeNull();
    const cancelled = (await req("GET", "/admin/bookings?status=cancelled")).json().bookings;
    expect(cancelled.map((b: any) => b.id)).toEqual([ids[1]]);
    expect((await req("GET", `/admin/bookings?status=confirmed&cursor=${p1.next_cursor}`)).statusCode).toBe(400); // cursor from another listing
    expect((await req("GET", "/admin/bookings?status=pending")).statusCode).toBe(400);
  });

  it("overview counts open upcoming slots and bookings by status", async () => {
    await req("POST", "/admin/slots", { slots: [{ id: "past", provider: "Dr C", start: "2020-01-01T09:00:00Z", end: "2020-01-01T09:30:00Z" }] });
    const b = await book("a", "o@x.com");
    await book("b", "o2@x.com");
    await req("DELETE", `/bookings/${b.json().id}`);
    expect((await req("GET", "/admin/overview")).json()).toEqual({
      slots_total: 3,
      slots_open_upcoming: 1, // a (freed by cancel); b is booked; past has started
      bookings_confirmed: 1,
      bookings_cancelled: 1,
      providers: ["Dr A", "Dr B", "Dr C"],
    });
  });

  it("/reset still behaves exactly as the contract says", async () => {
    await book("a", "r@x.com");
    const r = await req("POST", "/reset", { slots: [slot("z", 9)] });
    expect(r.json()).toEqual({ ok: true, slots: 1 });
    expect((await req("GET", "/admin/bookings")).json().bookings).toEqual([]);
  });
});
