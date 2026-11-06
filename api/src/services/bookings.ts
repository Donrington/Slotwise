import type pg from "pg";
import { systemClock, type Clock } from "../lib/clock.js";
import { HttpError } from "../lib/errors.js";

const COLS = `id, slot_id, name, email, status, created_at`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toBooking(r: any) {
  return { ...r, created_at: new Date(r.created_at).toISOString() };
}

export async function createBooking(
  pool: pg.Pool,
  b: { slot_id: string; name: string; email: string },
  clock: Clock = systemClock,
) {
  const slot = await pool.query("SELECT id, start_at FROM slots WHERE id = $1", [b.slot_id]);
  if (slot.rowCount === 0) throw new HttpError(404, "slot not found");
  if (new Date(slot.rows[0].start_at).getTime() <= clock.now().getTime()) {
    throw new HttpError(400, "slot has already started");
  }
  const { rows } = await pool.query(
    `INSERT INTO bookings (slot_id, name, email) VALUES ($1, $2, $3) RETURNING ${COLS}`,
    [b.slot_id, b.name, b.email],
  );
  return toBooking(rows[0]);
}

export async function getBooking(pool: pg.Pool, id: string) {
  if (!UUID_RE.test(id)) throw new HttpError(404, "booking not found");
  const { rows } = await pool.query(`SELECT ${COLS} FROM bookings WHERE id = $1`, [id]);
  if (rows.length === 0) throw new HttpError(404, "booking not found");
  return toBooking(rows[0]);
}
