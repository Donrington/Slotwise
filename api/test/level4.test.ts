import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db.js";
import { encodeCursor } from "../src/lib/cursor.js";
import { requestHash } from "../src/lib/hash.js";

const url = process.env.TEST_DATABASE_URL;
const KEY = "test-key-0123456789abcdef";

describe("requestHash", () => {
  it("ignores key order and whitespace/case normalisation", () => {
    const a = requestHash({ slot_id: "s1", name: " Ann ", email: "ANN@x.com" });
    const b = requestHash({ email: "ann@x.com ", name: "Ann", slot_id: "s1" });
    expect(a).toBe(b);
    expect(requestHash({ slot_id: "s2", name: "Ann", email: "ann@x.com" })).not.toBe(a);
  });
});

describe.skipIf(!url)("level 4", () => {
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
  const count = async () => (await pool.query("SELECT count(*)::int n FROM bookings")).rows[0].n as number;

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

  it("same key twice sequentially: identical status and body, one row", async () => {
    const body = { slot_id: "s1", name: "Ann", email: "ann@x.com" };
    const a = await book(body, { "idempotency-key": "k1" });
    const b = await book({ email: " ANN@x.com", name: "Ann", slot_id: "s1" }, { "idempotency-key": "k1" });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(b.json()).toEqual(a.json());
    expect(await count()).toBe(1);
  });

  it("same key fired 10 times concurrently: one booking id, one row", async () => {
    const body = { slot_id: "s2", name: "Ann", email: "ann@x.com" };
    const res = await Promise.all(Array.from({ length: 10 }, () => book(body, { "idempotency-key": "kc" })));
    expect(new Set(res.map((r) => r.statusCode))).toEqual(new Set([201]));
    expect(new Set(res.map((r) => r.json().id)).size).toBe(1);
    expect(await count()).toBe(1);
  });

  it("same key with a different body is 422", async () => {
    await book({ slot_id: "s3", name: "Ann", email: "ann@x.com" }, { "idempotency-key": "kd" });
    const r = await book({ slot_id: "s4", name: "Ann", email: "ann@x.com" }, { "idempotency-key": "kd" });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toEqual({ error: "idempotency key reused with a different request" });
    expect(await count()).toBe(1);
  });

  it("different keys, same slot: 201 then 409", async () => {
    const a = await book({ slot_id: "s5", name: "A", email: "a@x.com" }, { "idempotency-key": "x1" });
    const b = await book({ slot_id: "s5", name: "B", email: "b@x.com" }, { "idempotency-key": "x2" });
    expect([a.statusCode, b.statusCode]).toEqual([201, 409]);
  });

  it("replay of a 409 and of a 400 returns the same", async () => {
    await book({ slot_id: "s6", name: "A", email: "a@x.com" });
    const body = { slot_id: "s6", name: "B", email: "b@x.com" };
    const a = await book(body, { "idempotency-key": "r409" });
    expect(a.statusCode).toBe(409);
    await app.inject({ method: "DELETE", url: `/bookings/${(await pool.query("SELECT id FROM bookings")).rows[0].id}`, headers });
    const b = await book(body, { "idempotency-key": "r409" });
    expect(b.statusCode).toBe(409); // stored, not re-evaluated
    expect(b.json()).toEqual(a.json());
    const bad = { slot_id: "s7", name: "", email: "b@x.com" };
    const c = await book(bad, { "idempotency-key": "r400" });
    const d = await book(bad, { "idempotency-key": "r400" });
    expect([c.statusCode, d.statusCode]).toEqual([400, 400]);
    expect(d.json()).toEqual(c.json());
  });

  it("empty and over-long keys", async () => {
    const r = await book({ slot_id: "s8", name: "A", email: "a@x.com" }, { "idempotency-key": "" });
    expect(r.statusCode).toBe(201);
    const long = await book({ slot_id: "s9", name: "A", email: "a@x.com" }, { "idempotency-key": "k".repeat(256) });
    expect(long.statusCode).toBe(400);
  });

  it("reset clears idempotency keys", async () => {
    const body = { slot_id: "s1", name: "A", email: "a@x.com" };
    await book(body, { "idempotency-key": "reuse" });
    await app.inject({ method: "POST", url: "/reset", headers, payload: { slots } });
    const again = await book({ ...body, slot_id: "s2" }, { "idempotency-key": "reuse" });
    expect(again.statusCode).toBe(201);
  });

  describe("pagination", () => {
    const list = (qs: string) => app.inject({ method: "GET", url: `/bookings?${qs}`, headers });

    it("walks 10, 10, 5 with no gaps or duplicates", async () => {
      for (let i = 0; i < 25; i++) expect((await book({ slot_id: `s${i + 1}`, name: "A", email: "Pat@x.com" })).statusCode).toBe(201);
      for (let i = 25; i < 28; i++) await book({ slot_id: `s${i + 1}`, name: "B", email: "other@x.com" });
      const ids: string[] = [];
      const sizes: number[] = [];
      let cursor: string | null = null;
      let last: any;
      do {
        const r = await list(`email=PAT@x.com&limit=10${cursor ? `&cursor=${cursor}` : ""}`);
        expect(r.statusCode).toBe(200);
        last = r.json();
        sizes.push(last.bookings.length);
        ids.push(...last.bookings.map((b: any) => b.slot_id));
        cursor = last.next_cursor;
      } while (cursor);
      expect(sizes).toEqual([10, 10, 5]);
      expect(last.next_cursor).toBeNull();
      expect(ids).toEqual(Array.from({ length: 25 }, (_, i) => `s${i + 1}`));
      expect((await list("email=other@x.com")).json().bookings).toHaveLength(3);
    });

    it("exact multiple of limit ends with next_cursor null", async () => {
      for (let i = 0; i < 4; i++) await book({ slot_id: `s${i + 1}`, name: "A", email: "a@x.com" });
      const r1 = (await list("email=a@x.com&limit=2")).json();
      expect(r1.next_cursor).not.toBeNull();
      const r2 = (await list(`email=a@x.com&limit=2&cursor=${r1.next_cursor}`)).json();
      expect(r2.bookings).toHaveLength(2);
      expect(r2.next_cursor).toBeNull();
    });

    it("limit edge cases", async () => {
      for (const l of ["0", "51", "-1", "abc", "1.5", ""]) {
        const r = await list(`email=a@x.com&limit=${l}`);
        expect(r.statusCode, `limit=${l}`).toBe(400);
        expect(r.json()).toEqual({ error: "limit must be an integer between 1 and 50" });
      }
      for (const l of ["1", "50"]) expect((await list(`email=a@x.com&limit=${l}`)).statusCode).toBe(200);
      expect((await list("email=a@x.com")).statusCode).toBe(200);
    });

    it("email is required; bad or tampered cursor is 400", async () => {
      expect((await list("limit=5")).statusCode).toBe(400);
      expect((await list("email=")).statusCode).toBe(400);
      for (const c of ["!!!", "abc", encodeCursor(0), Buffer.from("seq:-3").toString("base64url"), Buffer.from("hello").toString("base64url")]) {
        expect((await list(`email=a@x.com&cursor=${c}`)).statusCode, c).toBe(400);
      }
    });

    it("includes cancelled bookings", async () => {
      const a = await book({ slot_id: "s1", name: "A", email: "c@x.com" });
      await app.inject({ method: "DELETE", url: `/bookings/${a.json().id}`, headers });
      await book({ slot_id: "s1", name: "A", email: "c@x.com" });
      const r = (await list("email=c@x.com")).json();
      expect(r.bookings.map((b: any) => b.status)).toEqual(["cancelled", "confirmed"]);
    });
  });
});
