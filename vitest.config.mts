import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Resolve the "@/*" alias from tsconfig.json.
    tsconfigPaths: true,
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          setupFiles: ["./tests/setup.ts"],
          include: ["tests/unit/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
        },
      },
      {
        // Against the local Supabase stack (`npm run db:start`); see README.
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          setupFiles: ["./tests/integration/setup.ts"],
          include: ["tests/integration/**/*.test.ts"],
          testTimeout: 20_000,
          // Test files share one database; keep them from racing each other.
          fileParallelism: false,
        },
      },
    ],
  },
});
