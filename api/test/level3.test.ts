import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db.js";

const url = process.env.TEST_DATABASE_URL;
const KEY = "test-key-0123456789abcdef";

describe.skipIf(!url)("level 3", () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildApp>;
  const headers = { "x-api-key": KEY };
  const slots = Array.from({ length: 12 }, (_, i) => ({
    id: `s${i + 1}`,
    provider: "P",
    start: `2031-01-01T${String(8 + i).padStart(2, "0")}:00:00Z`,
    end: `2031-01-01T${String(8 + i).padStart(2, "0")}:30:00Z`,
  }));
  const book = (slot_id: string, email: string) =>
    app.inject({ method: "POST", url: "/bookings", headers, payload: { slot_id, name: "N", email } });
  const cancel = (id: string) => app.inject({ method: "DELETE", url: `/bookings/${id}`, headers });

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
    await app.inject({ method: "POST", url: "/reset", headers, payload: { slots } });
  });

  it("25 concurrent bookings for one slot: exactly one 201, 24 409, one row", async () => {
    const res = await Promise.all(Array.from({ length: 25 }, (_, i) => book("s1", `u${i}@x.com`)));
    const codes = res.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(24);
    for (const r of res.filter((r) => r.statusCode === 409)) expect(r.json()).toEqual({ error: "slot already booked" });
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM bookings WHERE slot_id='s1' AND status='confirmed'");
    expect(rows[0].n).toBe(1);
  });

  it("book, cancel, book again: 201, 200, 201; cancelled booking is still fetchable", async () => {
    const a = await book("s2", "a@x.com");
    expect(a.statusCode).toBe(201);
    const c = await cancel(a.json().id);
    expect(c.statusCode).toBe(200);
    expect(c.json()).toMatchObject({ id: a.json().id, status: "cancelled" });
    const slotList = (await app.inject({ method: "GET", url: "/slots", headers })).json().slots;
    expect(slotList.find((s: any) => s.id === "s2").available).toBe(true);
    const b = await book("s2", "b@x.com");
    expect(b.statusCode).toBe(201);
    const got = await app.inject({ method: "GET", url: `/bookings/${a.json().id}`, headers });
    expect(got.json().status).toBe("cancelled");
  });

  it("double cancel is 200 then 409; unknown and malformed ids are 404", async () => {
    const a = await book("s3", "a@x.com");
    expect((await cancel(a.json().id)).statusCode).toBe(200);
    const again = await cancel(a.json().id);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: "booking already cancelled" });
    expect((await cancel("00000000-0000-0000-0000-000000000000")).statusCode).toBe(404);
    expect((await cancel("nope")).statusCode).toBe(404);
  });

  it("concurrent double cancel: one 200, the rest 409", async () => {
    const a = await book("s4", "a@x.com");
    const res = await Promise.all(Array.from({ length: 8 }, () => cancel(a.json().id)));
    const codes = res.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(7);
  });

  it("10 concurrent bookings across 10 slots all succeed", async () => {
    const res = await Promise.all(Array.from({ length: 10 }, (_, i) => book(`s${i + 1}`, `p${i}@x.com`)));
    expect(res.map((r) => r.statusCode)).toEqual(Array(10).fill(201));
  });
});
