import { describe, expect, it } from "vitest";
import { poolConfig } from "../src/db.js";

describe("poolConfig", () => {
  it("verifies TLS for a hosted database and strips sslmode from the URL", () => {
    const c = poolConfig("postgres://u:p@ep-x-pooler.eu-west-2.aws.neon.tech/db?sslmode=require");
    expect(c.ssl).toEqual({ rejectUnauthorized: true });
    expect(c.connectionString).not.toMatch(/sslmode/);
    expect(c.connectionTimeoutMillis).toBe(10000);
  });
  it("uses TLS for any non-local host even without sslmode", () => {
    expect(poolConfig("postgres://u:p@db.example.com/db").ssl).toEqual({ rejectUnauthorized: true });
  });
  it("skips TLS for localhost", () => {
    expect(poolConfig("postgres://u:p@localhost/db").ssl).toBeUndefined();
    expect(poolConfig("postgres://u:p@127.0.0.1/db").ssl).toBeUndefined();
  });
});
