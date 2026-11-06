import type pg from "pg";
import { systemClock, type Clock } from "../lib/clock.js";
import type { CursorCodec } from "../lib/cursor.js";
import { HttpError } from "../lib/errors.js";
import { requestHash } from "../lib/hash.js";
import { parseBookingBody } from "../lib/validate.js";

const COLS = `id, slot_id, name, email, status, created_at`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Queryable = Pick<pg.Pool, "query">;
export interface Reply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

/** Runs once per real attempt (never for a replay). Returns a reply (e.g. 429) to stop, or undefined to go on. */
export type Gate = () => Reply | undefined;

function toBooking(r: any) {
  return {
    id: r.id,
    slot_id: r.slot_id,
    name: r.name,
    email: r.email,
    status: r.status,
    created_at: new Date(r.created_at).toISOString(),
  };
}

/**
 * Validates and inserts. Business failures (400/404/409) come back as a Reply so
 * they can be stored for idempotent replay; unexpected errors are thrown (500).
 * With `savepoint`, the insert is wrapped so a unique violation does not abort
 * the surrounding transaction.
 */
export async function attemptBooking(
  db: Queryable,
  rawBody: unknown,
  clock: Clock,
  savepoint: boolean,
): Promise<Reply> {
  try {
    const b = parseBookingBody(rawBody);
    const slot = await db.query("SELECT start_at FROM slots WHERE id = $1", [b.slot_id]);
    if (slot.rowCount === 0) throw new HttpError(404, "slot not found");
    if (new Date(slot.rows[0].start_at).getTime() <= clock.now().getTime()) {
      throw new HttpError(400, "slot has already started");
    }
    if (savepoint) await db.query("SAVEPOINT booking_insert");
    try {
      // No availability pre-check: the partial unique index decides, atomically.
      const { rows } = await db.query(
        `INSERT INTO bookings (slot_id, name, email) VALUES ($1, $2, $3) RETURNING ${COLS}`,
        [b.slot_id, b.name, b.email],
      );
      if (savepoint) await db.query("RELEASE SAVEPOINT booking_insert");
      return { status: 201, body: toBooking(rows[0]) };
    } catch (e: any) {
      if (savepoint) await db.query("ROLLBACK TO SAVEPOINT booking_insert");
      if (e?.code === "23505" && e?.constraint === "bookings_one_confirmed_per_slot") {
        throw new HttpError(409, "slot already booked");
      }
      if (e?.code === "23503") throw new HttpError(404, "slot not found"); // removed by a concurrent /reset
      throw e;
    }
  } catch (e) {
    if (e instanceof HttpError) return { status: e.statusCode, body: { error: e.message } };
    throw e;
  }
}

/** Looks up a stored response for this key. Same hash: replay; other hash: undefined (caller ends in 422). */
export async function findReplay(db: Queryable, key: string, rawBody: unknown): Promise<Reply | undefined> {
  const { rows } = await db.query(
    "SELECT request_hash, status_code, response_body FROM idempotency_keys WHERE key = $1",
    [key],
  );
  const row = rows[0];
  if (row && row.request_hash === requestHash(rawBody)) {
    return { status: row.status_code, body: row.response_body };
  }
  return undefined;
}

export async function createBookingIdempotent(
  pool: pg.Pool,
  rawBody: unknown,
  key: string | undefined,
  clock: Clock = systemClock,
  gate: Gate = () => undefined,
): Promise<Reply> {
  if (!key) return gate() ?? (await attemptBooking(pool, rawBody, clock, false));

  const hash = requestHash(rawBody);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Requests with the same key serialise here, so a concurrent twin waits and then replays.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
    const found = await client.query(
      "SELECT request_hash, status_code, response_body FROM idempotency_keys WHERE key = $1",
      [key],
    );
    const row = found.rows[0];
    if (row && row.request_hash === hash) {
      // A replay (including a concurrent twin that waited on the lock) is a retry, not a new attempt: not counted.
      await client.query("COMMIT");
      return { status: row.status_code, body: row.response_body };
    }
    // From here it is a real attempt, so it is rate limited. Doing this after the lock means ten
    // simultaneous requests with one key consume ONE attempt. A 429 is never stored.
    const blocked = gate();
    if (blocked) {
      await client.query("COMMIT");
      return blocked;
    }
    if (row) {
      await client.query("COMMIT");
      return { status: 422, body: { error: "idempotency key reused with a different request" } };
    }
    const reply = await attemptBooking(client, rawBody, clock, true);
    await client.query(
      `INSERT INTO idempotency_keys (key, request_hash, status_code, response_body) VALUES ($1, $2, $3, $4)`,
      [key, hash, reply.status, JSON.stringify(reply.body)],
    );
    await client.query("COMMIT");
    return reply;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e; // 5xx is never stored
  } finally {
    client.release();
  }
}

export async function getBooking(pool: pg.Pool, id: string) {
  if (!UUID_RE.test(id)) throw new HttpError(404, "booking not found");
  const { rows } = await pool.query(`SELECT ${COLS} FROM bookings WHERE id = $1`, [id]);
  if (rows.length === 0) throw new HttpError(404, "booking not found");
  return toBooking(rows[0]);
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

export async function listBookings(
  pool: pg.Pool,
  codec: CursorCodec,
  emailRaw: unknown,
  limit: number,
  cursor: string | undefined,
) {
  if (typeof emailRaw !== "string" || emailRaw.trim() === "") throw new HttpError(400, "email is required");
  const email = emailRaw.trim().toLowerCase();
  const after = cursor === undefined ? "0" : codec.decode(email, cursor);
  const { rows } = await pool.query(
    `SELECT seq, ${COLS} FROM bookings WHERE email = $1 AND seq > $2 ORDER BY seq ASC LIMIT $3`,
    [email, after, limit + 1],
  );
  const page = rows.slice(0, limit);
  const next = rows.length > limit ? codec.encode(email, page[page.length - 1].seq) : null;
  return { bookings: page.map(toBooking), next_cursor: next };
}
