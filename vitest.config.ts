import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
          exclude: ["packages/*/test/**/*.browser.test.ts", "apps/*/test/**/*.browser.test.ts"],
        },
      },
      {
        test: {
          name: "browser",
          environment: "node",
          include: ["packages/*/test/**/*.browser.test.ts", "apps/*/test/**/*.browser.test.ts"],
          testTimeout: 120_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
