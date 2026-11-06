import { describe, expect, it } from "vitest";
import { isValidEmail, parseBookingBody } from "../src/lib/validate.js";

const ok = { slot_id: "s1", name: "Ann", email: "ann@x.com" };
const fails = (body: unknown, msg?: string) => {
  try {
    parseBookingBody(body);
  } catch (e: any) {
    expect(e.statusCode).toBe(400);
    if (msg) expect(e.message).toBe(msg);
    return;
  }
  throw new Error("expected failure");
};

describe("parseBookingBody", () => {
  it("accepts a valid body", () => expect(parseBookingBody(ok)).toEqual(ok));
  it("trims and lower-cases", () =>
    expect(parseBookingBody({ slot_id: " s1 ", name: "  Ann Lee ", email: "  Ann@X.COM " })).toEqual({
      slot_id: "s1",
      name: "Ann Lee",
      email: "ann@x.com",
    }));
  it("rejects non-objects", () => {
    for (const b of [null, undefined, "x", 5, [], [ok]]) fails(b);
  });
  it("rejects missing fields", () => {
    fails({ ...ok, slot_id: undefined }, "slot_id is required");
    fails({ ...ok, name: undefined }, "name is required");
    fails({ ...ok, email: undefined }, "email is required");
  });
  it("rejects empty and whitespace-only", () => {
    fails({ ...ok, name: "" }, "name is required");
    fails({ ...ok, name: "   " }, "name is required");
    fails({ ...ok, slot_id: " " }, "slot_id is required");
    fails({ ...ok, email: " " }, "email is required");
  });
  it("rejects non-string types", () => {
    fails({ ...ok, name: 5 }, "name is required");
    fails({ ...ok, slot_id: 1 });
    fails({ ...ok, email: ["a@b.com"] });
    fails({ ...ok, name: null });
  });
  it("rejects bad emails", () => {
    for (const email of ["a@b", "@x.com", "a b@x.com", "a@@x.com", "plain", "a@x.", "a@.com", "a@x..com"]) {
      fails({ ...ok, email }, "email is invalid");
    }
    fails({ ...ok, email: "a".repeat(250) + "@x.com" }, "email is invalid");
  });
  it("isValidEmail accepts normal addresses", () => {
    for (const e of ["a@b.co", "first.last+tag@sub.example.com"]) expect(isValidEmail(e)).toBe(true);
  });
});
