import { describe, expect, it } from "vitest";
import { SlidingWindowLimiter } from "../src/lib/rateLimiter.js";

function make() {
  let t = 1_000_000;
  const clock = { now: () => new Date(t) };
  return { l: new SlidingWindowLimiter(clock), advance: (ms: number) => (t += ms) };
}

describe("SlidingWindowLimiter", () => {
  it("allows 5 then blocks the 6th", () => {
    const { l } = make();
    for (let i = 0; i < 5; i++) expect(l.consume("a")).toEqual({ allowed: true });
    expect(l.consume("a")).toMatchObject({ allowed: false });
  });

  it("computes Retry-After from the oldest attempt, minimum 1", () => {
    const { l, advance } = make();
    for (let i = 0; i < 5; i++) l.consume("a");
    expect(l.consume("a")).toEqual({ allowed: false, retryAfterSeconds: 60 });
    advance(20_000);
    expect(l.consume("a")).toEqual({ allowed: false, retryAfterSeconds: 40 });
    advance(39_500);
    expect(l.consume("a")).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it("slides: allowed again after the window", () => {
    const { l, advance } = make();
    for (let i = 0; i < 5; i++) l.consume("a");
    advance(61_000);
    expect(l.consume("a")).toEqual({ allowed: true });
  });

  it("does not record blocked attempts, so the client recovers on schedule", () => {
    const { l, advance } = make();
    for (let i = 0; i < 5; i++) l.consume("a");
    for (let i = 0; i < 10; i++) l.consume("a"); // blocked, not recorded
    advance(60_001);
    for (let i = 0; i < 5; i++) expect(l.consume("a")).toEqual({ allowed: true });
  });

  it("keeps emails independent", () => {
    const { l } = make();
    for (let i = 0; i < 6; i++) l.consume("a");
    expect(l.consume("b")).toEqual({ allowed: true });
  });

  it("clear() resets, gc() drops idle keys", () => {
    const { l, advance } = make();
    for (let i = 0; i < 5; i++) l.consume("a");
    l.clear();
    expect(l.consume("a")).toEqual({ allowed: true });
    advance(61_000);
    l.gc();
    expect(l.size).toBe(0);
  });
});
