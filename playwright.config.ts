import { defineConfig, devices } from "@playwright/test";

import { REMOTE_BASE_URL } from "./tests/e2e/support/target";

// Own port so E2E never reuses another app that is already on :3000.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const localURL = `http://localhost:${PORT}`;
// E2E_BASE_URL runs the suite against a deployed staging app instead (tests/e2e/support/target.ts).
const baseURL = REMOTE_BASE_URL ?? localURL;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  // A deployed app is slower per request than the local dev server once warm.
  timeout: REMOTE_BASE_URL ? 120_000 : 30_000,
  globalTeardown: REMOTE_BASE_URL ? "./tests/e2e/support/remote-teardown.ts" : undefined,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: REMOTE_BASE_URL
    ? undefined
    : {
        command: `npm run dev -- --port ${PORT}`,
        url: localURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        // Email links must point at this server (allowed in supabase/config.toml).
        env: { NEXT_PUBLIC_APP_URL: localURL },
      },
});
