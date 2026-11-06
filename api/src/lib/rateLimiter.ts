import type { Clock } from "./clock.js";
import { systemClock } from "./clock.js";

export type ConsumeResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Seam for swapping the implementation. NOTE: this app runs as ONE instance on
 * Render, so in-memory counters are correct. A multi-instance deployment would
 * need the counters in Postgres or Redis behind this same interface.
 */
export interface RateLimiter {
  consume(key: string): ConsumeResult;
  clear(): void;
}

export const WINDOW_MS = 60_000;
export const MAX_ATTEMPTS = 5;

/** Sliding-window log. consume() is synchronous, so check-and-record is atomic in one Node process. */
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
