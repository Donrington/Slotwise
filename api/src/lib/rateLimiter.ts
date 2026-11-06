import type pg from "pg";
import type { Clock } from "./clock.js";
import { systemClock } from "./clock.js";

export type ConsumeResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };
export type Queryable = Pick<pg.Pool, "query">;

/**
 * Seam for the limiter. `db`, when given, is a client inside the caller's open transaction, so the
 * attempt is recorded atomically with the rest of the request (and rolled back with it on a 5xx).
 */
export interface RateLimiter {
  consume(key: string, db?: Queryable): ConsumeResult | Promise<ConsumeResult>;
  clear(): void | Promise<void>;
}

export const WINDOW_MS = 60_000;
export const MAX_ATTEMPTS = 5;

/**
 * Production limiter: a sliding-window log in Postgres, exact across any number of instances
 * (Vercel runs the API as many). Attempts for one email serialise on a per-email advisory lock,
 * then the log is pruned, counted and appended in the same transaction. Uses the database clock
 * so instances with drifting clocks still agree.
 */
export class PgRateLimiter implements RateLimiter {
  constructor(
    private pool: pg.Pool,
    private max = MAX_ATTEMPTS,
    private windowMs = WINDOW_MS,
  ) {}

  async consume(key: string, db?: Queryable): Promise<ConsumeResult> {
    if (db) return this.consumeIn(db, key);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const r = await this.consumeIn(client, key);
      await client.query("COMMIT");
      return r;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  private async consumeIn(db: Queryable, key: string): Promise<ConsumeResult> {
    const win = `${this.windowMs} milliseconds`;
    // Seed 1 keeps these locks apart from the idempotency locks (seed 0).
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 1))", [`rate:${key}`]);
    await db.query("DELETE FROM rate_limit_attempts WHERE email = $1 AND at <= clock_timestamp() - $2::interval", [key, win]);
    const { rows } = await db.query(
      `SELECT count(*)::int AS n,
              extract(epoch FROM (min(at) + $2::interval - clock_timestamp()))::float8 AS wait
         FROM rate_limit_attempts WHERE email = $1`,
      [key, win],
    );
    if (rows[0].n < this.max) {
      await db.query("INSERT INTO rate_limit_attempts (email) VALUES ($1)", [key]);
      return { allowed: true }; // a rejected attempt is NOT recorded, so a blocked client recovers on schedule
    }
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(rows[0].wait)) };
  }

  async clear(): Promise<void> {
    await this.pool.query("TRUNCATE rate_limit_attempts");
  }
}

/**
 * In-memory sliding-window log. Correct only for a single process; kept for unit tests and for
 * running one local instance. consume() is synchronous, so check-and-record is atomic in-process.
 */
export class SlidingWindowLimiter implements RateLimiter {
  private hits = new Map<string, number[]>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private clock: Clock = systemClock,
    private max = MAX_ATTEMPTS,
    private windowMs = WINDOW_MS,
  ) {}

  consume(key: string): ConsumeResult {
    const now = this.clock.now().getTime();
    const recent = (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs);
    if (recent.length < this.max) {
      recent.push(now);
      this.hits.set(key, recent);
      return { allowed: true };
    }
    this.hits.set(key, recent); // a rejected attempt is NOT recorded
    const retryAfterSeconds = Math.max(1, Math.ceil((recent[0]! + this.windowMs - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  clear(): void {
    this.hits.clear();
  }

  /** Drop keys whose newest attempt is outside the window. */
  gc(): void {
    const now = this.clock.now().getTime();
    for (const [k, v] of this.hits) {
      if (v.length === 0 || v[v.length - 1]! <= now - this.windowMs) this.hits.delete(k);
    }
  }

  startGc(intervalMs = 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.gc(), intervalMs);
    this.timer.unref();
  }

  stopGc(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  get size(): number {
    return this.hits.size;
  }
}
