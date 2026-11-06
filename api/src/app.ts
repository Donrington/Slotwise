import Fastify, { type FastifyInstance } from "fastify";
import type pg from "pg";
import { getPool } from "./db.js";
import { assertApiKey, keysMatch } from "./lib/auth.js";
import { systemClock, type Clock } from "./lib/clock.js";
import { HttpError } from "./lib/errors.js";
import { parseLimit } from "./lib/cursor.js";
import { cancelBooking, createBookingIdempotent, findReplay, getBooking, listBookings } from "./services/bookings.js";
import { assertValidSlots, listSlots, resetSlots, type SlotInput } from "./services/slots.js";

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

export interface AppOptions {
  pool?: pg.Pool;
  apiKey: string;
  clock?: Clock;
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const pool = opts.pool ?? getPool();
  const apiKey = assertApiKey(opts.apiKey);
  const clock = opts.clock ?? systemClock;
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

  app.get("/healthz", async () => ({ ok: true }));

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
    return { ok: true, slots: count };
  });

  app.get("/slots", async (req) => {
    const q = req.query as Record<string, unknown>;
    return { slots: await listSlots(pool, isStr(q.provider) ? q.provider : undefined) };
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
    const result = await createBookingIdempotent(pool, req.body, key, clock);
    return reply.code(result.status).send(result.body);
  });

  app.get("/bookings", async (req) => {
    const q = req.query as Record<string, unknown>;
    return listBookings(pool, q.email, parseLimit(q.limit), isStr(q.cursor) ? q.cursor : undefined);
  });

  app.get("/bookings/:id", async (req) => getBooking(pool, (req.params as { id: string }).id));

  app.delete("/bookings/:id", async (req) => cancelBooking(pool, (req.params as { id: string }).id));

  return app;
}
