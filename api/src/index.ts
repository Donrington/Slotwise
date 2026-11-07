// Server entrypoint, here and on Vercel. Vercel's Fastify detector looks for src/index.ts (after
// src/app.ts, so the app factory is named buildApp.ts) and wants the entry to import fastify itself:
// this file owns the Fastify instance and hands it to buildApp.
import Fastify from "fastify";
import { buildApp } from "./buildApp.js";
import { closePool, migrateWithRetry } from "./db.js";
import { assertApiKey } from "./lib/auth.js";
import { liveSlotsFromEnv } from "./services/live.js";

const apiKey = assertApiKey(process.env.API_KEY);
const port = Number(process.env.PORT ?? 3000);

async function main() {
  // On Vercel the function bundle may not include migrations/, so they run at build time instead
  // (npm run vercel-build). Everywhere else the server migrates itself before listening.
  if (!process.env.VERCEL) await migrateWithRetry();
  const live = liveSlotsFromEnv();
  console.log(live ? "realtime: live slot queries enabled" : "realtime: not configured, page will poll");
  const app = buildApp({ apiKey, live, instance: Fastify({ logger: false }) });
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
