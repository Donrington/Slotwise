import { closePool, migrate } from "./db.js";

migrate()
  .then((applied) => console.log(applied.length ? `applied: ${applied.join(", ")}` : "up to date"))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closePool);
