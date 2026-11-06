import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
export const migrationsDir = path.resolve(here, "../migrations");

let pool: pg.Pool | undefined;

const isLocal = (host: string) => ["localhost", "127.0.0.1", "[::1]", ""].includes(host);

/**
 * Neon (and any hosted Postgres) gets TLS with a verified certificate; localhost dev databases
 * usually have no TLS, so SSL is skipped there unless the URL asks for it. channel_binding=require
 * from Neon's URL is honoured explicitly, because pg ignores that URL parameter otherwise.
 * No statement_timeout here: it would be sent as a startup parameter, which Neon's pooler can
 * refuse. Server-side timeouts are set on the role by migration 005; query_timeout is a client-side
 * backstop for a connection that hangs (for example while a compute wakes up).
 */
export function poolConfig(raw: string, max = 10): pg.PoolConfig {
  const u = new URL(raw);
  const mode = u.searchParams.get("sslmode");
  const binding = u.searchParams.get("channel_binding");
  u.searchParams.delete("sslmode"); // ssl is set explicitly below so the URL cannot weaken it
  u.searchParams.delete("channel_binding");
  const useSsl = mode ? mode !== "disable" : !isLocal(u.hostname);
  return {
    connectionString: u.toString(),
    ssl: useSsl ? { rejectUnauthorized: true } : undefined,
    enableChannelBinding: binding === "require",
    max,
    connectionTimeoutMillis: 10_000, // Neon may be waking from scale-to-zero
    query_timeout: 15_000,
    idleTimeoutMillis: 30_000,
  } as pg.PoolConfig;
}

export function getPool(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL; // pooled (-pooler) for application traffic
    if (!url) throw new Error("DATABASE_URL is not set");
    pool = new pg.Pool(poolConfig(url));
    // An idle connection can drop when Neon scales to zero; without a listener that error event
    // would crash the process. The pool discards the broken client and opens a new one when needed.
    pool.on("error", (e) => console.error(`idle database connection lost: ${e.message}`));
  }
  return pool;
}

/**
 * Migrations run over the DIRECT connection (DATABASE_URL_UNPOOLED, as `neon env pull` writes it),
 * falling back to DATABASE_URL. Retries with backoff so a database still waking up does not crash boot.
 */
export async function migrateWithRetry(attempts = 5): Promise<string[]> {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const direct = new pg.Pool(poolConfig(url, 1));
  try {
    for (let i = 1; ; i++) {
      try {
        return await migrate(direct);
      } catch (e) {
        if (i >= attempts) throw e;
        const wait = 500 * 2 ** (i - 1);
        console.error(`migration attempt ${i}/${attempts} failed (${e instanceof Error ? e.message : "error"}); retrying in ${wait} ms`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  } finally {
    await direct.end();
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
