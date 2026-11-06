import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
export const migrationsDir = path.resolve(here, "../migrations");

let pool: pg.Pool | undefined;

const isLocal = (host: string) => ["localhost", "127.0.0.1", "[::1]", ""].includes(host);

/**
 * Hosted databases (Neon) require TLS with a verified certificate. Local development databases
 * usually have no TLS, so SSL is skipped for localhost unless the URL asks for it with sslmode=require.
 */
export function poolConfig(raw: string): pg.PoolConfig {
  const u = new URL(raw);
  const mode = u.searchParams.get("sslmode");
  u.searchParams.delete("sslmode"); // ssl is set explicitly below so the URL cannot weaken it
  const useSsl = mode ? mode !== "disable" : !isLocal(u.hostname);
  return {
    connectionString: u.toString(),
    ssl: useSsl ? { rejectUnauthorized: true } : undefined,
    max: 10,
    connectionTimeoutMillis: 10_000, // Neon may be waking from autosuspend
    statement_timeout: 10_000, // a stuck query must not wedge the API
    idleTimeoutMillis: 30_000,
  };
}

export function getPool(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    pool = new pg.Pool(poolConfig(url));
  }
  return pool;
}

/** Retries with backoff so a database that is still waking up does not crash the boot. */
export async function migrateWithRetry(attempts = 5): Promise<string[]> {
  for (let i = 1; ; i++) {
    try {
      return await migrate();
    } catch (e) {
      if (i >= attempts) throw e;
      const wait = 500 * 2 ** (i - 1);
      console.error(`migration attempt ${i}/${attempts} failed (${e instanceof Error ? e.message : "error"}); retrying in ${wait} ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

/** Runs SQL files from /api/migrations in filename order, once each. */
export async function migrate(p: pg.Pool = getPool()): Promise<string[]> {
  await p.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files) {
    const client = await p.connect();
    try {
      await client.query("BEGIN");
      // serialise concurrent migrators
      await client.query("SELECT pg_advisory_xact_lock(727001)");
      const done = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
      if (done.rowCount === 0) {
        const sql = await readFile(path.join(migrationsDir, file), "utf8");
        if (sql.trim()) await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        applied.push(file);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  return applied;
}
