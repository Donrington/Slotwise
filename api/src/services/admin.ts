// Clinic-staff operations behind /admin/*. Additive to the contract: nothing here changes how the
// checked endpoints behave. Same API key as everything else; the web app gates these behind a staff login.
import type pg from "pg";
import type { CursorCodec } from "../lib/cursor.js";
import { HttpError } from "../lib/errors.js";
import type { SlotInput } from "./slots.js";

const MAX_SLOTS_PER_REQUEST = 500;

/** Adds slots without touching existing slots or bookings. All-or-nothing; an existing id is 409. */
export async function addSlots(pool: pg.Pool, slots: SlotInput[]) {
  if (slots.length === 0) throw new HttpError(400, "slots must not be empty");
  if (slots.length > MAX_SLOTS_PER_REQUEST) throw new HttpError(400, `at most ${MAX_SLOTS_PER_REQUEST} slots per request`);
  for (const s of slots) {
    if (s.id.trim() === "" || s.id.length > 100) throw new HttpError(400, "slot id must be 1 to 100 characters");
    if (s.provider.trim() === "" || s.provider.length > 120) throw new HttpError(400, "provider must be 1 to 120 characters");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const taken = await client.query("SELECT id FROM slots WHERE id = ANY($1::text[])", [slots.map((s) => s.id)]);
    if (taken.rowCount) {
      throw new HttpError(409, `slot id already exists: ${taken.rows.map((r) => r.id).slice(0, 5).join(", ")}`);
    }
    for (const s of slots) {
      await client.query(
        `INSERT INTO slots (id, provider, start_raw, end_raw, start_at, end_at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [s.id, s.provider, s.start, s.end, new Date(s.start), new Date(s.end)],
      );
    }
    await client.query("COMMIT");
    return { added: slots.length, slots: slots.map(({ id, provider, start, end }) => ({ id, provider, start, end, available: true })) };
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    if (e?.code === "23505") throw new HttpError(409, "slot id already exists"); // a concurrent add won the race
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Removes a slot unless a confirmed booking holds it (cancel that first). The row lock makes this safe
 * against a booking racing it: the booking's foreign-key check waits, then finds the slot gone (404).
 * Cancelled bookings for the slot go with it.
 */
export async function deleteSlot(pool: pg.Pool, id: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const slot = await client.query("SELECT id FROM slots WHERE id = $1 FOR UPDATE", [id]);
    if (slot.rowCount === 0) throw new HttpError(404, "slot not found");
    const held = await client.query("SELECT 1 FROM bookings WHERE slot_id = $1 AND status = 'confirmed'", [id]);
    if (held.rowCount) throw new HttpError(409, "slot has a confirmed booking; cancel it first");
    await client.query("DELETE FROM slots WHERE id = $1", [id]);
    await client.query("COMMIT");
    return { deleted: id };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Every slot, earliest first, with who holds it when it is booked. */
export async function adminSlots(pool: pg.Pool) {
  const { rows } = await pool.query(
    `SELECT s.id, s.provider, s.start_raw AS start, s.end_raw AS "end",
            b.id AS booking_id, b.name AS booking_name, b.email AS booking_email, b.created_at AS booking_created_at
       FROM slots s
       LEFT JOIN bookings b ON b.slot_id = s.id AND b.status = 'confirmed'
      ORDER BY s.start_at ASC, s.id ASC`,
  );
  return {
    slots: rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      start: r.start,
      end: r.end,
      available: r.booking_id === null,
      booking:
        r.booking_id === null
          ? null
          : { id: r.booking_id, name: r.booking_name, email: r.booking_email, created_at: new Date(r.booking_created_at).toISOString() },
    })),
  };
}

const STATUSES = new Set(["confirmed", "cancelled"]);

/** All bookings, newest first, with their slot. Optional ?status filter; signed cursor pagination. */
export async function adminBookings(pool: pg.Pool, codec: CursorCodec, statusRaw: unknown, limit: number, cursor: string | undefined) {
  if (statusRaw !== undefined && (typeof statusRaw !== "string" || !STATUSES.has(statusRaw))) {
    throw new HttpError(400, "status must be confirmed or cancelled");
  }
  const status = statusRaw as string | undefined;
  const scope = `admin:${status ?? "all"}`; // a cursor only works for the listing that issued it
  const before = cursor === undefined ? null : codec.decode(scope, cursor);
  const { rows } = await pool.query(
    `SELECT b.seq, b.id, b.slot_id, b.name, b.email, b.status, b.created_at,
            s.provider, s.start_raw AS start, s.end_raw AS "end"
       FROM bookings b JOIN slots s ON s.id = b.slot_id
      WHERE ($1::text IS NULL OR b.status = $1) AND ($2::bigint IS NULL OR b.seq < $2)
      ORDER BY b.seq DESC LIMIT $3`,
    [status ?? null, before, limit + 1],
  );
  const page = rows.slice(0, limit);
  return {
    bookings: page.map((r) => ({
      id: r.id,
      slot_id: r.slot_id,
      name: r.name,
      email: r.email,
      status: r.status,
      created_at: new Date(r.created_at).toISOString(),
      slot: { provider: r.provider, start: r.start, end: r.end },
    })),
    next_cursor: rows.length > limit ? codec.encode(scope, page[page.length - 1].seq) : null,
  };
}

/** Headline numbers for the staff dashboard. "Upcoming" means the slot has not started yet. */
export async function overview(pool: pg.Pool) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*) FROM slots)::int AS slots_total,
       (SELECT count(*) FROM slots s WHERE s.start_at > now()
          AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.slot_id = s.id AND b.status = 'confirmed'))::int AS slots_open_upcoming,
       (SELECT count(*) FROM bookings WHERE status = 'confirmed')::int AS bookings_confirmed,
       (SELECT count(*) FROM bookings WHERE status = 'cancelled')::int AS bookings_cancelled,
       (SELECT coalesce(json_agg(DISTINCT provider ORDER BY provider), '[]'::json) FROM slots) AS providers`,
  );
  return rows[0];
}
