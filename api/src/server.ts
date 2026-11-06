import { buildApp } from "./app.js";
import { migrate } from "./db.js";

const port = Number(process.env.PORT ?? 3000);

async function main() {
  await migrate();
  const app = buildApp();
  await app.listen({ port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
