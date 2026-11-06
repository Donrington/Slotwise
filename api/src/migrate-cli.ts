import { closePool, migrateWithRetry } from "./db.js";

// Build-time migrations on Vercel (npm run vercel-build). A build without a database (for example a
// preview deployment with no DATABASE_URL) skips them instead of failing.
if (!process.env.DATABASE_URL && !process.env.DATABASE_URL_UNPOOLED) {
  console.log("migrations: no DATABASE_URL, skipped");
} else {
  migrateWithRetry()
    .then((applied) => console.log(applied.length ? `migrations applied: ${applied.join(", ")}` : "migrations: up to date"))
    .catch((e) => {
      console.error(`migrations failed: ${e instanceof Error ? e.message : e}`);
      process.exitCode = 1;
    })
    .finally(closePool);
}
