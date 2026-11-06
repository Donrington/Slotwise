import { createRealtime, rawSql } from "@neon/realtime/server";

/** Columns and shape match GET /slots, so the page can render live rows with the same code. */
export interface LiveSlotRow {
  id: string;
  provider: string;
  start: string;
  end: string;
  available: boolean;
}

// Read-only and deterministic, as Realtime requires. It exposes no names or emails, only what
// GET /slots already shows, so the sealed query is safe to hand to the public page.
export const LIVE_SLOTS_SQL = `SELECT s.id, s.provider, s.start_raw AS start, s.end_raw AS "end",
  NOT EXISTS (SELECT 1 FROM bookings b WHERE b.slot_id = s.id AND b.status = 'confirmed') AS available
  FROM slots s ORDER BY s.start_at ASC, s.id ASC`;

export interface LiveSlots {
  url: string;
  seal(): Promise<unknown>;
}

/** Database name for Realtime's `db` option, taken from DATABASE_URL's path (Neon: neondb). */
export function databaseName(databaseUrl: string): string {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
  if (!name) throw new Error("DATABASE_URL has no database name");
  return name;
}

/** Undefined when Realtime is not configured; the page then keeps polling GET /slots. */
export function liveSlotsFromEnv(env: NodeJS.ProcessEnv = process.env): LiveSlots | undefined {
  const { NEON_REALTIME_SECRET: secret, NEON_REALTIME_URL: url, DATABASE_URL: db } = env;
  if (!secret || !url || !db) return undefined;
  const realtime = createRealtime({ secret, db: databaseName(db) });
  return { url, seal: () => realtime.seal({ query: rawSql<LiveSlotRow>(LIVE_SLOTS_SQL) }) };
}
