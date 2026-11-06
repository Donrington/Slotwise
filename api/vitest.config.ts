import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // integration tests share one Postgres database, so files run one at a time
    fileParallelism: false,
    testTimeout: 20000,
  },
});
