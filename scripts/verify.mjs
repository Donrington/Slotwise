#!/usr/bin/env node
// End-to-end contract check for the Slotwise API. Dependency-free, Node 20+ (fetch only).
//
//   node scripts/verify.mjs --base https://your-api.onrender.com --key YOUR_API_KEY [--slow]
//   BASE_URL=... API_KEY=... node scripts/verify.mjs
//
// WARNING: this calls POST /reset, which wipes all bookings and slots. Run it before you submit,
// never against a deployment an assessor is about to check.
//
// --slow also waits out the rate-limit window: it checks a blocked email recovers after Retry-After,
// and walks pagination over 23 bookings (the 5-per-minute limit means that takes a few minutes).

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const BASE = (opt("base") ?? process.env.BASE_URL ?? "").replace(/\/+$/, "");
const KEY = opt("key") ?? process.env.API_KEY ?? "";
const SLOW = flag("slow");
if (!BASE || !KEY) {
  console.error("Usage: node scripts/verify.mjs --base <url> --key <api key> [--slow]\n(or BASE_URL and API_KEY env vars)");
  process.exit(2);
}

// ---------- tiny harness ----------
const RUN = Math.random().toString(36).slice(2, 8);
const results = []; // {level, name, ok, detail}
const slowRequests = [];
const badErrorBodies = [];
let level = "setup";
let seq = 0;
const email = (tag = "u") => `${tag}${++seq}.${RUN}@verify.test`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, { body, key = KEY, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (key !== null) h["X-API-Key"] = key;
  let payload;
  if (raw !== undefined) {
    payload = raw;
    h["Content-Type"] = "application/json";
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    h["Content-Type"] = "application/json";
  }
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(BASE + path, { method, headers: h, body: payload, signal: AbortSignal.timeout(70_000) });
  } catch (e) {
    return { status: 0, json: null, headers: new Headers(), ms: Date.now() - t0, netError: String(e?.cause?.code ?? e?.message ?? e) };
  }
  const ms = Date.now() - t0;
  if (ms > 3000) slowRequests.push(`${method} ${path.split("?")[0]} took ${ms} ms`);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  if (res.status >= 400 && !(json && typeof json.error === "string")) {
    badErrorBodies.push(`${method} ${path.split("?")[0]} -> ${res.status} without {"error": string}`);
  }
  return { status: res.status, json, text, headers: res.headers, ms };
}

async function check(name, fn) {
  let ok = false;
  let detail = "";
  try {
    const r = await fn();
    ok = r === undefined || r === true;
    if (!ok) detail = typeof r === "string" ? r : "";
  } catch (e) {
    detail = e?.message ?? String(e);
  }
  results.push({ level, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  [${level}] ${name}${ok || !detail ? "" : `\n        ${detail}`}`);
}
const eq = (a, b, what) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what ?? "value"}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const expectStatus = (r, s, what = "") => {
  if (r.status !== s) throw new Error(`${what} expected HTTP ${s}, got ${r.status}${r.netError ? ` (${r.netError})` : ""} ${r.json ? JSON.stringify(r.json) : ""}`.trim());
};
const groupBy = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});

// ---------- fixtures ----------
const iso = (d) => d.toISOString().replace(".000Z", "Z");
function baseSlots() {
  const t0 = new Date();
  t0.setUTCDate(t0.getUTCDate() + 1);
  t0.setUTCHours(9, 0, 0, 0);
  const slots = [];
  for (let i = 0; i < 12; i++) {
    slots.push({
      id: `s${i + 1}`,
      provider: i % 2 === 0 ? "Dr Ade" : "Dr Bisi",
      start: iso(new Date(t0.getTime() + i * 1800_000)),
      end: iso(new Date(t0.getTime() + (i + 1) * 1800_000)),
    });
  }
  const past = new Date(Date.now() - 3 * 3600_000);
  past.setUTCSeconds(0, 0);
  slots.push({ id: "p1", provider: "Dr Ade", start: iso(past), end: iso(new Date(past.getTime() + 1800_000)) });
  const past2 = new Date(past.getTime() - 3600_000);
  slots.push({ id: "p2", provider: "Dr Bisi", start: iso(past2), end: iso(new Date(past2.getTime() + 1800_000)) });
  return slots;
}
// slots with unusual date formats, used to check start/end come back exactly as sent
const oddSlots = () => [
  { id: "x1", provider: "Dr Odd", start: "2099-01-01T09:00:00+01:00", end: "2099-01-01T09:30:00+01:00" },
  { id: "x2", provider: "Dr Odd", start: "2099-01-01T10:00:00.250Z", end: "2099-01-01T10:30:00.250Z" },
];
async function fresh(extra = []) {
  const slots = [...baseSlots(), ...extra];
  const r = await api("POST", "/reset", { body: { slots } });
  if (r.status !== 200) throw new Error(`/reset failed with HTTP ${r.status} ${JSON.stringify(r.json)}`);
  return slots;
}
const book = (slot_id, em, name = "Test Patient", headers = {}) =>
  api("POST", "/bookings", { body: { slot_id, name, email: em }, headers });

// ---------- level 1 ----------
async function level1() {
  level = "L1";
  let slots;
  await check("POST /reset returns 200", async () => {
    slots = baseSlots().concat(oddSlots());
    const r = await api("POST", "/reset", { body: { slots } });
    expectStatus(r, 200);
  });
  await check("GET /slots sorted by start, with all fields, all available", async () => {
    const r = await api("GET", "/slots");
    expectStatus(r, 200);
    const list = r.json?.slots;
    if (!Array.isArray(list)) throw new Error("no slots array");
    eq(list.length, slots.length, "slot count");
    for (const s of list) {
      for (const f of ["id", "provider", "start", "end"]) if (typeof s[f] !== "string") throw new Error(`slot ${s.id} missing ${f}`);
      if (s.available !== true) throw new Error(`slot ${s.id} not available`);
    }
    const times = list.map((s) => Date.parse(s.start));
    for (let i = 1; i < times.length; i++) if (times[i] < times[i - 1]) throw new Error("not sorted by start ascending");
  });
  await check("start and end are returned exactly as sent to /reset", async () => {
    const list = (await api("GET", "/slots")).json.slots;
    for (const sent of slots) {
      const got = list.find((s) => s.id === sent.id);
      if (!got) throw new Error(`missing ${sent.id}`);
      if (got.start !== sent.start || got.end !== sent.end) throw new Error(`${sent.id}: sent ${sent.start}/${sent.end}, got ${got.start}/${got.end}`);
    }
  });
  await check("provider filter is exact and case-sensitive", async () => {
    const ade = (await api("GET", "/slots?provider=Dr%20Ade")).json.slots;
    if (!ade.length || ade.some((s) => s.provider !== "Dr Ade")) throw new Error("exact filter wrong");
    const lower = await api("GET", "/slots?provider=dr%20ade");
    expectStatus(lower, 200);
    eq(lower.json.slots.length, 0, "lower-case provider matches");
    const prefix = await api("GET", "/slots?provider=Dr");
    eq(prefix.json.slots.length, 0, "prefix matches");
  });
  const em = email("l1");
  let booking;
  await check("POST /bookings returns 201 with the booking shape", async () => {
    const r = await book("s1", em, "Ann Lee");
    expectStatus(r, 201);
    booking = r.json;
    for (const f of ["id", "slot_id", "name", "email", "status", "created_at"]) if (typeof booking[f] !== "string") throw new Error(`missing ${f}`);
    eq(booking.status, "confirmed", "status");
    eq(booking.slot_id, "s1", "slot_id");
    if (Number.isNaN(Date.parse(booking.created_at))) throw new Error("created_at not a date");
  });
  await check("booked slot shows available false", async () => {
    const s = (await api("GET", "/slots")).json.slots.find((x) => x.id === "s1");
    eq(s.available, false, "available");
  });
  await check("GET /bookings/{id} returns the same booking", async () => {
    const r = await api("GET", `/bookings/${booking.id}`);
    expectStatus(r, 200);
    eq(r.json, booking, "booking");
  });
  await check("GET /bookings/{unknown} is 404", async () => {
    expectStatus(await api("GET", "/bookings/00000000-0000-4000-8000-000000000000"), 404);
    expectStatus(await api("GET", "/bookings/not-a-real-id"), 404);
  });
}

// ---------- level 2 ----------
async function level2() {
  level = "L2";
  await fresh();
  const noKeyRoutes = [
    ["POST", "/reset", { slots: [] }],
    ["GET", "/slots"],
    ["POST", "/bookings", { slot_id: "s1", name: "A", email: "a@x.com" }],
    ["GET", "/bookings/00000000-0000-4000-8000-000000000000"],
    ["DELETE", "/bookings/00000000-0000-4000-8000-000000000000"],
    ["GET", "/bookings?email=a@x.com"],
    ["GET", "/this-route-does-not-exist"],
  ];
  await check("missing key gives 401 on every route, unknown path included", async () => {
    for (const [m, p, body] of noKeyRoutes) {
      const r = await api(m, p, { body, key: null });
      if (r.status !== 401) throw new Error(`${m} ${p} -> ${r.status}`);
    }
  });
  await check("wrong key gives 401 on every route", async () => {
    for (const [m, p, body] of noKeyRoutes) {
      const r = await api(m, p, { body, key: "definitely-not-the-key" });
      if (r.status !== 401) throw new Error(`${m} ${p} -> ${r.status}`);
    }
  });
  await check("the failed 401 requests changed nothing (reset without key did not wipe slots)", async () => {
    const r = await api("GET", "/slots");
    if (r.json.slots.length < 14) throw new Error("slots were wiped by an unauthenticated /reset");
  });
  const good = { slot_id: "s2", name: "Ann", email: "ann@x.com" };
  const bad = {
    "missing slot_id": { name: "A", email: "a@x.com" },
    "missing name": { slot_id: "s2", email: "a@x.com" },
    "missing email": { slot_id: "s2", name: "A" },
    "empty slot_id": { ...good, slot_id: "" },
    "empty name": { ...good, name: "" },
    "empty email": { ...good, email: "" },
    "whitespace-only name": { ...good, name: "   " },
    "whitespace-only email": { ...good, email: "   " },
    "email a@b": { ...good, email: "a@b" },
    "email @x.com": { ...good, email: "@x.com" },
    "email with a space": { ...good, email: "a b@x.com" },
    "non-string name": { ...good, name: 42 },
  };
  for (const [label, body] of Object.entries(bad)) {
    await check(`400 for ${label}`, async () => {
      // unique email per attempt where possible so the limiter never interferes; emails stay invalid where that is the point
      const r = await api("POST", "/bookings", { body });
      expectStatus(r, 400);
    });
  }
  await check("400 for malformed JSON", async () => {
    expectStatus(await api("POST", "/bookings", { raw: "{not json" }), 400);
  });
  await check("404 for an unknown slot", async () => {
    expectStatus(await book("no-such-slot", email("l2")), 404);
  });
  await check("400 for a slot that already started", async () => {
    expectStatus(await book("p1", email("l2")), 400);
    expectStatus(await book("p2", email("l2")), 400);
  });
  await check("name and email are trimmed and the email lower-cased", async () => {
    const em = email("L2Trim");
    const r = await api("POST", "/bookings", { body: { slot_id: "s3", name: "  Ann Lee  ", email: `  ${em.toUpperCase()}  ` } });
    expectStatus(r, 201);
    eq(r.json.name, "Ann Lee", "name");
    eq(r.json.email, em.toLowerCase(), "email");
  });
}

// ---------- level 3 ----------
async function level3() {
  level = "L3";
  await fresh();
  const emails = Array.from({ length: 30 }, (_, i) => email(`race${i}`));
  let winnerId;
  await check("30 concurrent bookings for one slot: exactly one 201 and twenty-nine 409", async () => {
    const res = await Promise.all(emails.map((e) => book("s1", e)));
    const counts = groupBy(res, (r) => r.status);
    eq(counts, { 201: 1, 409: 29 }, "status counts");
    winnerId = res.find((r) => r.status === 201).json.id;
  });
  await check("exactly one confirmed booking exists for the slot", async () => {
    const lists = await Promise.all(emails.map((e) => api("GET", `/bookings?email=${encodeURIComponent(e)}&limit=50`)));
    const confirmed = lists.flatMap((r) => r.json.bookings).filter((b) => b.slot_id === "s1" && b.status === "confirmed");
    eq(confirmed.length, 1, "confirmed bookings");
    eq(confirmed[0].id, winnerId, "winner id");
    eq((await api("GET", "/slots")).json.slots.find((s) => s.id === "s1").available, false, "available");
  });
  await check("cancel returns 200 with status cancelled and frees the slot", async () => {
    const r = await api("DELETE", `/bookings/${winnerId}`);
    expectStatus(r, 200);
    eq(r.json.status, "cancelled", "status");
    eq(r.json.id, winnerId, "id");
    eq((await api("GET", "/slots")).json.slots.find((s) => s.id === "s1").available, true, "available");
  });
  await check("a new booking on the freed slot is 201", async () => {
    expectStatus(await book("s1", email("l3")), 201);
  });
  await check("cancelling twice gives 200 then 409", async () => {
    const r = await book("s2", email("l3"));
    expectStatus(await api("DELETE", `/bookings/${r.json.id}`), 200);
    expectStatus(await api("DELETE", `/bookings/${r.json.id}`), 409);
  });
  await check("cancelling an unknown booking is 404", async () => {
    expectStatus(await api("DELETE", "/bookings/00000000-0000-4000-8000-000000000000"), 404);
    expectStatus(await api("DELETE", "/bookings/not-a-real-id"), 404);
  });
  await check("a cancelled booking can still be fetched, with status cancelled", async () => {
    const r = await api("GET", `/bookings/${winnerId}`);
    expectStatus(r, 200);
    eq(r.json.status, "cancelled", "status");
  });
  await check("concurrent double cancel: one 200, the rest 409", async () => {
    const r = await book("s3", email("l3"));
    const res = await Promise.all(Array.from({ length: 8 }, () => api("DELETE", `/bookings/${r.json.id}`)));
    const c = groupBy(res, (x) => x.status);
    eq(c, { 200: 1, 409: 7 }, "status counts");
  });
  await check("concurrent bookings on different slots all succeed", async () => {
    const res = await Promise.all(["s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11"].map((s) => book(s, email("l3par"))));
    eq(groupBy(res, (x) => x.status), { 201: 8 }, "status counts");
  });
}

// ---------- level 4 ----------
async function level4() {
  level = "L4";
  await fresh();
  const idem = (k) => ({ "Idempotency-Key": k });
  const key = (t) => `${t}-${RUN}-${++seq}`;

  await check("same key and same body twice: same status, same booking id, one booking", async () => {
    const em = email("idem"), k = key("twice");
    const a = await book("s1", em, "Ann", idem(k));
    const b = await book("s1", em, "Ann", idem(k));
    expectStatus(a, 201);
    eq(b.status, 201, "replay status");
    eq(b.json.id, a.json.id, "booking id");
    if (b.text !== a.text) throw new Error(`replay body is not byte-identical:\n          first:  ${a.text}\n          replay: ${b.text}`);
    const list = await api("GET", `/bookings?email=${encodeURIComponent(em)}`);
    eq(list.json.bookings.length, 1, "bookings for email");
  });
  await check("same key fired 10 times concurrently: one booking id", async () => {
    const em = email("idemc"), k = key("conc");
    const res = await Promise.all(Array.from({ length: 10 }, () => book("s2", em, "Ann", idem(k))));
    eq(groupBy(res, (r) => r.status), { 201: 10 }, "status counts");
    eq(new Set(res.map((r) => r.json.id)).size, 1, "distinct ids");
    eq((await api("GET", `/bookings?email=${encodeURIComponent(em)}`)).json.bookings.length, 1, "bookings");
  });
  await check("same key with a different body is 422", async () => {
    const em = email("idem422"), k = key("diff");
    expectStatus(await book("s3", em, "Ann", idem(k)), 201);
    expectStatus(await book("s4", em, "Ann", idem(k)), 422);
  });
  await check("different keys on the same slot: 201 then 409", async () => {
    const a = await book("s5", email("idemk"), "A", idem(key("k1")));
    const b = await book("s5", email("idemk"), "B", idem(key("k2")));
    eq([a.status, b.status], [201, 409], "statuses");
  });
  await check("a replayed 409 stays 409", async () => {
    const em = email("idem409"), k = key("r409");
    expectStatus(await book("s5", em, "A", idem(k)), 409);
    expectStatus(await book("s5", em, "A", idem(k)), 409);
  });

  // pagination. The 5-per-minute limit caps how many bookings one email can make in a window,
  // so the default run uses 5 bookings and limit=2; --slow does the full 23-booking walk.
  const walk = async (em, limit, upper = em) => {
    const pages = [];
    let cursor = null;
    do {
      const r = await api("GET", `/bookings?email=${encodeURIComponent(upper)}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      expectStatus(r, 200);
      if (!Array.isArray(r.json.bookings) || !("next_cursor" in r.json)) throw new Error("bad page shape");
      pages.push(r.json.bookings);
      cursor = r.json.next_cursor;
      if (pages.length > 30) throw new Error("pagination never ends");
    } while (cursor !== null);
    return pages;
  };
  const pagEmail = email("pag");
  let pagIds = [];
  await check("pagination: 5 bookings walk as 2, 2, 1 with no gaps or duplicates, oldest first", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await book(`s${i + 6}`, pagEmail);
      expectStatus(r, 201, `booking ${i + 1}`);
      pagIds.push(r.json.id);
    }
    const pages = await walk(pagEmail, 2);
    eq(pages.map((p) => p.length), [2, 2, 1], "page sizes");
    eq(pages.flat().map((b) => b.id), pagIds, "ids in booking order");
  });
  await check("pagination: the last page has next_cursor exactly null", async () => {
    const r = await api("GET", `/bookings?email=${encodeURIComponent(pagEmail)}&limit=5`);
    eq(r.json.next_cursor, null, "next_cursor");
    eq(r.json.bookings.length, 5, "count");
  });
  await check("pagination: email match ignores case", async () => {
    const r = await api("GET", `/bookings?email=${encodeURIComponent(pagEmail.toUpperCase())}&limit=50`);
    eq(r.json.bookings.length, 5, "count");
  });
  await check("pagination: a cancelled booking is still listed", async () => {
    expectStatus(await api("DELETE", `/bookings/${pagIds[0]}`), 200);
    const r = await api("GET", `/bookings?email=${encodeURIComponent(pagEmail)}&limit=50`);
    eq(r.json.bookings.length, 5, "count");
    eq(r.json.bookings[0].status, "cancelled", "first status");
  });
  await check("pagination: another email sees none of these bookings", async () => {
    const r = await api("GET", `/bookings?email=${encodeURIComponent(email("nobody"))}`);
    expectStatus(r, 200);
    eq(r.json, { bookings: [], next_cursor: null }, "empty page");
  });
  await check("limit 0, 51, -1, abc, 1.5 and empty are all 400", async () => {
    for (const l of ["0", "51", "-1", "abc", "1.5", ""]) expectStatus(await api("GET", `/bookings?email=${encodeURIComponent(pagEmail)}&limit=${l}`), 400, `limit=${l}`);
    expectStatus(await api("GET", `/bookings?email=${encodeURIComponent(pagEmail)}&limit=1`), 200);
    expectStatus(await api("GET", `/bookings?email=${encodeURIComponent(pagEmail)}&limit=50`), 200);
  });
  await check("missing or empty email is 400", async () => {
    expectStatus(await api("GET", "/bookings"), 400);
    expectStatus(await api("GET", "/bookings?email="), 400);
  });
  await check("a cursor from another email's listing is 400", async () => {
    const other = email("pag2");
    for (let i = 0; i < 2; i++) expectStatus(await book(`s${i + 11}`, other), 201);
    const p = await api("GET", `/bookings?email=${encodeURIComponent(other)}&limit=1`);
    if (!p.json.next_cursor) throw new Error("expected a next_cursor");
    expectStatus(await api("GET", `/bookings?email=${encodeURIComponent(pagEmail)}&cursor=${encodeURIComponent(p.json.next_cursor)}`), 400);
  });
  await check("a bad cursor is 400", async () => {
    for (const c of ["garbage", "!!!", "MTIz", "AAAA"]) expectStatus(await api("GET", `/bookings?email=${encodeURIComponent(pagEmail)}&cursor=${c}`), 400, `cursor=${c}`);
  });
}

async function paginationSlow() {
  level = "L4-slow";
  const total = 23;
  const slots = Array.from({ length: total }, (_, i) => ({
    id: `q${i + 1}`,
    provider: "Dr Ade",
    start: iso(new Date(Date.now() + (i + 1) * 3600_000 + 86_400_000)),
    end: iso(new Date(Date.now() + (i + 1) * 3600_000 + 86_400_000 + 1800_000)),
  }));
  expectStatus(await api("POST", "/reset", { body: { slots } }), 200);
  const em = email("walk23");
  const ids = [];
  console.log(`      (creating ${total} bookings for one email, waiting out the rate limit between batches of 5; this takes a few minutes)`);
  await check(`create ${total} bookings across rate-limit windows`, async () => {
    for (let i = 0; i < total; i++) {
      let r = await book(`q${i + 1}`, em);
      while (r.status === 429) {
        const wait = Number(r.headers.get("retry-after")) || 60;
        await sleep(wait * 1000 + 500);
        r = await book(`q${i + 1}`, em);
      }
      expectStatus(r, 201, `booking ${i + 1}`);
      ids.push(r.json.id);
    }
  });
  await check("limit=10 walks 10, 10, 3 with no duplicates, oldest first, next_cursor null at the end", async () => {
    const pages = [];
    let cursor = null;
    do {
      const r = await api("GET", `/bookings?email=${encodeURIComponent(em)}&limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      expectStatus(r, 200);
      pages.push(r.json.bookings);
      cursor = r.json.next_cursor;
    } while (cursor !== null);
    eq(pages.map((p) => p.length), [10, 10, 3], "page sizes");
    eq(pages.flat().map((b) => b.id), ids, "ids in order");
  });
}

// ---------- level 5 ----------
async function level5() {
  level = "L5";
  await fresh();
  const six = email("six");
  await check("six quick POSTs for one email (valid and invalid mix): 1 to 5 are not 429, the 6th is 429 with Retry-After", async () => {
    const calls = [
      () => book("s1", six),
      () => api("POST", "/bookings", { body: { slot_id: "s1", name: "", email: six } }),
      () => book("no-such-slot", six),
      () => book("s1", six), // 409
      () => book("s2", six),
    ];
    const codes = [];
    for (const c of calls) codes.push((await c()).status);
    if (codes.some((c) => c === 429)) throw new Error(`one of attempts 1 to 5 was 429: ${codes}`);
    const sixth = await book("s3", six);
    expectStatus(sixth, 429, `attempt 6 (earlier: ${codes})`);
    const ra = sixth.headers.get("retry-after");
    if (!/^[0-9]+$/.test(ra ?? "") || Number(ra) < 1) throw new Error(`Retry-After should be a whole number >= 1, got ${JSON.stringify(ra)}`);
    if (typeof sixth.json?.error !== "string") throw new Error("429 body missing error");
  });
  await check("a different email is unaffected while the first is blocked", async () => {
    expectStatus(await book("s4", email("six-other")), 201);
  });
  await check("20 concurrent POSTs for one fresh email give exactly 5 non-429 responses", async () => {
    const em = email("burst");
    const res = await Promise.all(Array.from({ length: 20 }, (_, i) => book(`s${(i % 6) + 5}`, em)));
    const non429 = res.filter((r) => r.status !== 429).length;
    if (non429 !== 5) throw new Error(`expected 5 non-429, got ${non429} (${JSON.stringify(groupBy(res, (r) => r.status))})`);
  });
  await check("idempotent replays do not count toward the limit", async () => {
    await fresh();
    const em = email("replay"), k = `rl-${RUN}-${++seq}`;
    const first = await book("s1", em, "A", { "Idempotency-Key": k });
    expectStatus(first, 201);
    for (let i = 0; i < 10; i++) {
      const r = await book("s1", em, "A", { "Idempotency-Key": k });
      if (r.status !== 201 || r.json.id !== first.json.id) throw new Error(`replay ${i + 1} gave ${r.status}`);
    }
    for (let i = 0; i < 4; i++) {
      const r = await book(`s${i + 2}`, em);
      if (r.status === 429) throw new Error(`fresh attempt ${i + 2} was blocked, so replays were counted`);
    }
    expectStatus(await book("s7", em), 429, "the 6th counted attempt");
  });
  await check("a 429 is not stored: it does not poison an idempotency key", async () => {
    await fresh();
    const em = email("poison"), k = `p-${RUN}-${++seq}`;
    for (let i = 0; i < 5; i++) await book(`s${i + 1}`, em);
    expectStatus(await book("s6", em, "A", { "Idempotency-Key": k }), 429);
    // after reset the limiter is clear; the same key must now be processed fresh, not replayed as 429
    await fresh();
    expectStatus(await book("s6", em, "A", { "Idempotency-Key": k }), 201);
  });
  await check("after /reset the first email can book again", async () => {
    await fresh();
    expectStatus(await book("s1", six), 201);
  });
  if (SLOW) {
    await check("--slow: a blocked email is allowed again after Retry-After", async () => {
      await fresh();
      const em = email("slow");
      for (let i = 0; i < 5; i++) await book(`s${i + 1}`, em);
      const blocked = await book("s6", em);
      expectStatus(blocked, 429);
      const wait = Number(blocked.headers.get("retry-after"));
      console.log(`      (waiting ${wait + 1} s for the window to slide)`);
      await sleep((wait + 1) * 1000);
      expectStatus(await book("s6", em), 201, "attempt after waiting");
    });
  }
}

// ---------- extras ----------
async function extras() {
  level = "EXTRA";
  await check("CORS preflight succeeds without a key", async () => {
    const r = await fetch(BASE + "/bookings", {
      method: "OPTIONS",
      headers: { Origin: "https://example.com", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-api-key,content-type,idempotency-key" },
      signal: AbortSignal.timeout(30_000),
    });
    if (r.status < 200 || r.status >= 300) throw new Error(`preflight returned ${r.status}`);
    const allow = (r.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    if (!allow.includes("x-api-key")) throw new Error(`Access-Control-Allow-Headers missing x-api-key: ${allow || "(none)"}`);
    if (!r.headers.get("access-control-allow-origin")) throw new Error("Access-Control-Allow-Origin missing");
  });
  await check("GET /healthz works without a key", async () => {
    const r = await api("GET", "/healthz", { key: null });
    expectStatus(r, 200);
  });
  await check("every error body was JSON with a string error field", async () => {
    if (badErrorBodies.length) throw new Error(`${badErrorBodies.length} bad: ${[...new Set(badErrorBodies)].slice(0, 5).join("; ")}`);
  });
}

// ---------- run ----------
console.log(`Verifying ${BASE} (run ${RUN}${SLOW ? ", --slow" : ""})\n`);
const t0 = Date.now();
const warm = await api("GET", "/healthz", { key: null });
if (warm.status === 0) {
  console.error(`Cannot reach ${BASE}: ${warm.netError}`);
  process.exit(1);
}
try {
  await level1();
  await level2();
  await level3();
  await level4();
  await level5();
  if (SLOW) await paginationSlow();
  await extras();
} catch (e) {
  results.push({ level, name: "script error", ok: false, detail: e?.message ?? String(e) });
  console.log(`FAIL  [${level}] script error: ${e?.message ?? e}`);
}

console.log("\nSummary");
const levels = [...new Set(results.map((r) => r.level))];
for (const l of levels) {
  const rs = results.filter((r) => r.level === l);
  const pass = rs.filter((r) => r.ok).length;
  console.log(`  ${l.padEnd(8)} ${pass}/${rs.length} ${pass === rs.length ? "PASS" : "FAIL"}`);
}
if (slowRequests.length) {
  console.log(`\nWARN: ${slowRequests.length} request(s) took over 3 s (cold start?). First: ${slowRequests[0]}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failed ? 1 : 0);
