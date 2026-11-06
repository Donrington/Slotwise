import { describe, expect, it } from "vitest";
import { poolConfig } from "../src/db.js";

describe("poolConfig", () => {
  it("verifies TLS for a hosted database and strips sslmode from the URL", () => {
    const c = poolConfig("postgres://u:p@ep-x-pooler.eu-west-2.aws.neon.tech/db?sslmode=require");
    expect(c.ssl).toEqual({ rejectUnauthorized: true });
    expect(c.connectionString).not.toMatch(/sslmode/);
    expect(c.connectionTimeoutMillis).toBe(10000);
  });
  it("honours channel_binding=require and never sends statement_timeout as a startup parameter", () => {
    const c = poolConfig("postgresql://u:p@ep-x-pooler.c-9.us-east-2.aws.neon.tech/neondb?channel_binding=require&sslmode=require") as any;
    expect(c.enableChannelBinding).toBe(true);
    expect(c.connectionString).not.toMatch(/channel_binding|sslmode/);
    expect(c.statement_timeout).toBeUndefined();
    expect(c.query_timeout).toBe(15000);
    expect((poolConfig("postgres://u:p@db.example.com/db") as any).enableChannelBinding).toBe(false);
  });
  it("uses TLS for any non-local host even without sslmode", () => {
    expect(poolConfig("postgres://u:p@db.example.com/db").ssl).toEqual({ rejectUnauthorized: true });
  });
  it("skips TLS for localhost", () => {
    expect(poolConfig("postgres://u:p@localhost/db").ssl).toBeUndefined();
    expect(poolConfig("postgres://u:p@127.0.0.1/db").ssl).toBeUndefined();
  });
});

import pg from "pg";
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("role timeouts (migration 005)", () => {
  it("new sessions get statement_timeout from the role, with no startup parameter", async () => {
    const { migrate } = await import("../src/db.js");
    const p = new pg.Pool(poolConfig(url!, 1));
    await migrate(p);
    await p.end();
    const fresh = new pg.Pool(poolConfig(url!, 1)); // new session picks up the role default
    const r = await fresh.query("SHOW statement_timeout");
    await fresh.end();
    expect(r.rows[0].statement_timeout).toBe("10s");
  });
});
