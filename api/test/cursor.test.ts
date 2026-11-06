import { describe, expect, it } from "vitest";
import { cursorCodec } from "../src/lib/cursor.js";

const codec = cursorCodec("secret-a");
const fails = (fn: () => unknown) => {
  try {
    fn();
  } catch (e: any) {
    expect(e.statusCode).toBe(400);
    expect(e.message).toBe("invalid cursor");
    return;
  }
  throw new Error("expected invalid cursor");
};

describe("cursorCodec", () => {
  it("round-trips a seq for the same email", () => {
    expect(codec.decode("a@x.com", codec.encode("a@x.com", "42"))).toBe("42");
    expect(codec.decode("a@x.com", codec.encode("a@x.com", 9007199254740993n))).toBe("9007199254740993");
  });
  it("is opaque base64url", () => {
    expect(codec.encode("a@x.com", 7)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it("rejects a cursor from another email", () => fails(() => codec.decode("b@x.com", codec.encode("a@x.com", 5))));
  it("rejects a cursor signed with another secret", () => fails(() => codec.decode("a@x.com", cursorCodec("secret-b").encode("a@x.com", 5))));
  it("rejects an edited seq", () => {
    const [, mac] = Buffer.from(codec.encode("a@x.com", 5), "base64url").toString().split(".");
    fails(() => codec.decode("a@x.com", Buffer.from(`6.${mac}`).toString("base64url")));
  });
  it("rejects a flipped character", () => {
    const c = codec.encode("a@x.com", 5);
    const flipped = c.slice(0, -2) + (c.at(-2) === "A" ? "B" : "A") + c.at(-1);
    fails(() => codec.decode("a@x.com", flipped));
  });
  it("rejects garbage, zero and negative seqs", () => {
    for (const c of ["", "!!!", "abc", Buffer.from("0.x").toString("base64url"), Buffer.from("-1.x").toString("base64url"), "A".repeat(300)]) {
      fails(() => codec.decode("a@x.com", c));
    }
  });
});
