import { buildApp } from "./app.js";
import { closePool, migrateWithRetry } from "./db.js";
import { liveSlotsFromEnv } from "./services/live.js";
import { assertApiKey } from "./lib/auth.js";

const apiKey = assertApiKey(process.env.API_KEY);
const port = Number(process.env.PORT ?? 3000);

async function main() {
  await migrateWithRetry();
  const live = liveSlotsFromEnv();
  console.log(live ? "realtime: live slot queries enabled" : "realtime: not configured, page will poll");
  const app = buildApp({ apiKey, live });
  await app.listen({ port, host: "0.0.0.0" });

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down`);
    try {
      await app.close();
      await closePool();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
