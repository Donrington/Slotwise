import Fastify, { type FastifyInstance } from "fastify";
import type pg from "pg";
import { getPool } from "./db.js";
import { HttpError } from "./lib/errors.js";
import { createBooking, getBooking } from "./services/bookings.js";
import { assertValidSlots, listSlots, resetSlots, type SlotInput } from "./services/slots.js";

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

export function buildApp(pool: pg.Pool = getPool()): FastifyInstance {
  const app = Fastify({ logger: false });

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
    const b = req.body;
    if (!isObj(b) || !isStr(b.slot_id) || !isStr(b.name) || !isStr(b.email)) {
      throw new HttpError(400, "slot_id, name and email are required strings");
    }
    const booking = await createBooking(pool, { slot_id: b.slot_id, name: b.name, email: b.email });
    return reply.code(201).send(booking);
  });

  app.get("/bookings/:id", async (req) => getBooking(pool, (req.params as { id: string }).id));

  return app;
}
