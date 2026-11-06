import Fastify, { type FastifyInstance } from "fastify";
import type pg from "pg";
import { getPool } from "./db.js";
import { assertApiKey, keysMatch } from "./lib/auth.js";
import { systemClock, type Clock } from "./lib/clock.js";
import { HttpError } from "./lib/errors.js";
import { PgRateLimiter, type RateLimiter } from "./lib/rateLimiter.js";
import { createHash } from "node:crypto";
import { cursorCodec, parseLimit } from "./lib/cursor.js";
import { cancelBooking, createBookingIdempotent, findReplay, getBooking, listBookings, type Reply } from "./services/bookings.js";
import type { LiveSlots } from "./services/live.js";
import { assertValidSlots, listSlots, resetSlots, type SlotInput } from "./services/slots.js";

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

export interface AppOptions {
  pool?: pg.Pool;
  apiKey: string;
  clock?: Clock;
  limiter?: RateLimiter;
  /** Neon Realtime sealing for live slot availability; omitted means GET /slots polling only. */
  live?: LiveSlots;
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const apiKey = assertApiKey(opts.apiKey); // fail fast on the key before touching the database
  const pool = opts.pool ?? getPool();
  const clock = opts.clock ?? systemClock;
  // Postgres-backed by default: exact across instances. Tests may inject the in-memory one.
  const limiter: RateLimiter = opts.limiter ?? new PgRateLimiter(pool);
  // Cursor signing secret, derived from the API key so there is no extra env var to manage.
  const cursors = cursorCodec(createHash("sha256").update(`slotwise-cursor:${apiKey}`).digest("hex"));
  const app = Fastify({ logger: false });

  // CORS: the page lives on another origin. Preflight is answered before auth.
  app.addHook("onRequest", async (req, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Expose-Headers", "Retry-After");
    if (req.method === "OPTIONS") {
      reply.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      reply.header("Access-Control-Allow-Headers", "X-API-Key, Content-Type, Idempotency-Key");
      reply.header("Access-Control-Max-Age", "86400");
      return reply.code(204).send();
    }
  });

  // Auth runs before routing work for every route, unknown ones included.
  app.addHook("onRequest", async (req, reply) => {
    if (req.method === "GET" && req.url.split("?")[0] === "/healthz") return;
    if (!keysMatch(req.headers["x-api-key"], apiKey)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof HttpError) {
      if (err.headers) reply.headers(err.headers);
      return reply.code(err.statusCode).send({ error: err.message });
    }
    const code = err?.statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return reply.code(code).send({ error: code === 400 ? "invalid request" : "request error" });
    }
    console.error(err instanceof Error ? err.message : "unknown error");
    return reply.code(500).send({ error: "internal server error" });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "not found" }));

  // Public (no key) so Render's health check and an uptime pinger work. A cheap SELECT 1 also keeps Neon awake.
  app.get("/healthz", async (_req, reply) => {
    try {
      await pool.query("SELECT 1");
      return { ok: true };
    } catch {
      return reply.code(503).send({ error: "db unavailable" });
    }
  });

  app.post("/reset", async (req) => {
    const body = req.body;
    if (!isObj(body) || !Array.isArray(body.slots)) throw new HttpError(400, "slots must be an array");
    for (const s of body.slots) {
      if (!isObj(s) || !isStr(s.id) || !isStr(s.provider) || !isStr(s.start) || !isStr(s.end)) {
        throw new HttpError(400, "invalid slot");
      }
    }
    const slots = body.slots as SlotInput[];
    assertValidSlots(slots);
    const count = await resetSlots(pool, slots);
    await limiter.clear();
    return { ok: true, slots: count };
  });

  app.get("/slots", async (req) => {
    const q = req.query as Record<string, unknown>;
    return { slots: await listSlots(pool, isStr(q.provider) ? q.provider : undefined) };
  });

  // Seals a short-lived live query over slot availability for the page to subscribe to.
  app.post("/slots/live", async (_req, reply) => {
    if (!opts.live) return reply.code(503).send({ error: "realtime not configured" });
    return { url: opts.live.url, sealed: await opts.live.seal() };
  });

  app.post("/bookings", async (req, reply) => {
    const rawKey = req.headers["idempotency-key"];
    const key = typeof rawKey === "string" && rawKey !== "" ? rawKey : undefined;
    if (key !== undefined && key.length > 255) throw new HttpError(400, "Idempotency-Key must be at most 255 characters");

    // Order of checks: key (hook), idempotent replay, [rate limit], then validation and insert.
    if (key) {
      const replay = await findReplay(pool, key, req.body);
      if (replay) return reply.code(replay.status).send(replay.body);
    }
    // Rate limit by normalised email, applied inside createBookingIdempotent once the request is known
    // not to be a replay. Every real attempt that carries an email counts, failures included.
    const email = (req.body as any)?.email;
    const limitKey = typeof email === "string" && email.trim() !== "" ? email.trim().toLowerCase() : undefined;
    const gate = async (db?: Parameters<RateLimiter["consume"]>[1]): Promise<Reply | undefined> => {
      if (!limitKey) return undefined; // no usable email: it will 400 anyway, and no key is invented from the IP
      const r = await limiter.consume(limitKey, db);
      return r.allowed
        ? undefined
        : { status: 429, body: { error: "too many attempts, retry later" }, headers: { "Retry-After": String(r.retryAfterSeconds) } };
    };
    const result = await createBookingIdempotent(pool, req.body, key, clock, gate);
    if (result.headers) reply.headers(result.headers);
    return reply.code(result.status).send(result.body);
  });

  app.get("/bookings", async (req) => {
    const q = req.query as Record<string, unknown>;
    return listBookings(pool, cursors, q.email, parseLimit(q.limit), isStr(q.cursor) ? q.cursor : undefined);
  });

  app.get("/bookings/:id", async (req) => getBooking(pool, (req.params as { id: string }).id));

  app.delete("/bookings/:id", async (req) => cancelBooking(pool, (req.params as { id: string }).id));

  return app;
}
