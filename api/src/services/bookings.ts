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
  // No availability pre-check: the partial unique index decides, atomically.
  try {
    const { rows } = await pool.query(
      `INSERT INTO bookings (slot_id, name, email) VALUES ($1, $2, $3) RETURNING ${COLS}`,
      [b.slot_id, b.name, b.email],
    );
    return toBooking(rows[0]);
  } catch (e: any) {
    if (e?.code === "23505" && e?.constraint === "bookings_one_confirmed_per_slot") {
      throw new HttpError(409, "slot already booked");
    }
    if (e?.code === "23503") throw new HttpError(404, "slot not found"); // slot removed by a concurrent /reset
    throw e;
  }
}

export async function cancelBooking(pool: pg.Pool, id: string) {
  if (!UUID_RE.test(id)) throw new HttpError(404, "booking not found");
  const upd = await pool.query(
    `UPDATE bookings SET status = 'cancelled' WHERE id = $1 AND status = 'confirmed' RETURNING ${COLS}`,
    [id],
  );
  if (upd.rows.length > 0) return toBooking(upd.rows[0]);
  const cur = await pool.query("SELECT status FROM bookings WHERE id = $1", [id]);
  if (cur.rows.length === 0) throw new HttpError(404, "booking not found");
  throw new HttpError(409, "booking already cancelled");
}

export async function getBooking(pool: pg.Pool, id: string) {
  if (!UUID_RE.test(id)) throw new HttpError(404, "booking not found");
  const { rows } = await pool.query(`SELECT ${COLS} FROM bookings WHERE id = $1`, [id]);
  if (rows.length === 0) throw new HttpError(404, "booking not found");
  return toBooking(rows[0]);
}
