import { expect, test } from "@playwright/test";

// The service worker only registers in production builds. Run against one:
//   npm run build && npm run start -- --port 3300
//   E2E_PRODUCTION_URL=http://localhost:3300 npx playwright test tests/e2e/pwa-production.spec.ts
const PRODUCTION_URL = process.env.E2E_PRODUCTION_URL;

test.describe("service worker in a production build", () => {
  test.skip(!PRODUCTION_URL, "set E2E_PRODUCTION_URL to a production build");
  test.use({ baseURL: PRODUCTION_URL });

  test("registers, keeps only static files, and shows the offline page without a network", async ({ page, context }) => {
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload();
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toMatch(/\/sw\.js$/);

    // Nothing but build assets, icons and the offline page is cached.
    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        for (const request of await (await caches.open(name)).keys()) urls.push(new URL(request.url).pathname);
      }
      return urls;
    });
    expect(cached).toContain("/offline.html");
    for (const path of cached) expect(path, path).toMatch(/^\/(_next\/static\/|icons\/|offline\.html$)/);

    await context.setOffline(true);
    await page.goto("/dashboard").catch(() => undefined);
    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
    await context.setOffline(false);
  });
});
