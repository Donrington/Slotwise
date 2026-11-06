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
