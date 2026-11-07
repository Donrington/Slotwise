import type pg from "pg";
import { HttpError } from "../lib/errors.js";

export interface SlotInput {
  id: string;
  provider: string;
  start: string;
  end: string;
}

export async function resetSlots(pool: pg.Pool, slots: SlotInput[]): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM bookings");
    await client.query("TRUNCATE idempotency_keys");
    await client.query("DELETE FROM slots");
    for (const s of slots) {
      await client.query(
        `INSERT INTO slots (id, provider, start_raw, end_raw, start_at, end_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [s.id, s.provider, s.start, s.end, new Date(s.start), new Date(s.end)],
      );
    }
    await client.query("COMMIT");
    return slots.length;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function listSlots(pool: pg.Pool, provider?: string) {
  const { rows } = await pool.query(
    `SELECT s.id, s.provider, s.start_raw AS start, s.end_raw AS "end",
            NOT EXISTS (SELECT 1 FROM bookings b WHERE b.slot_id = s.id AND b.status = 'confirmed') AS available
       FROM slots s
      WHERE ($1::text IS NULL OR s.provider = $1)
      ORDER BY s.start_at ASC, s.id ASC`,
    [provider ?? null],
  );
  return rows;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

/** Validates a {slots:[...]} body, shared by POST /reset and POST /admin/slots. */
export function parseSlotsBody(body: unknown): SlotInput[] {
  if (!isObj(body) || !Array.isArray(body.slots)) throw new HttpError(400, "slots must be an array");
  for (const s of body.slots) {
    if (!isObj(s) || !isStr(s.id) || !isStr(s.provider) || !isStr(s.start) || !isStr(s.end)) {
      throw new HttpError(400, "invalid slot");
    }
  }
  const slots = body.slots as SlotInput[];
  assertValidSlots(slots);
  return slots;
}

export function assertValidSlots(input: SlotInput[]) {
  const seen = new Set<string>();
  for (const s of input) {
    if (seen.has(s.id)) throw new HttpError(400, "duplicate slot id");
    seen.add(s.id);
    const a = Date.parse(s.start);
    const b = Date.parse(s.end);
    if (Number.isNaN(a) || Number.isNaN(b)) throw new HttpError(400, "invalid date");
    if (b <= a) throw new HttpError(400, "end must be after start");
  }
}
