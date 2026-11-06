import Fastify, { type FastifyInstance } from "fastify";
import type pg from "pg";
import { getPool } from "./db.js";
import { assertApiKey, keysMatch } from "./lib/auth.js";
import { systemClock, type Clock } from "./lib/clock.js";
import { HttpError } from "./lib/errors.js";
import { parseBookingBody } from "./lib/validate.js";
import { createBooking, getBooking } from "./services/bookings.js";
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
    const input = parseBookingBody(req.body);
    const booking = await createBooking(pool, input, clock);
    return reply.code(201).send(booking);
  });

  app.get("/bookings/:id", async (req) => getBooking(pool, (req.params as { id: string }).id));

  return app;
}
