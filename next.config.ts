import type { NextConfig } from "next";

import { resolveAppUrl, validateEnv } from "./src/lib/env";

// On Vercel previews NEXT_PUBLIC_APP_URL is derived from the deployment URL.
const appUrl = resolveAppUrl(process.env);
if (appUrl) process.env.NEXT_PUBLIC_APP_URL = appUrl;

// Fail fast on missing or misplaced environment variables (SPEC §18).
// `next typegen` (run by `npm run typecheck`) also loads this file but needs no env.
if (!process.argv.includes("typegen")) {
  validateEnv(process.env);
}

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The default bottom-left dev badge covers the sidebar's Log out button.
  devIndicators: { position: "bottom-right" },
  // Inlines the resolved URL into client and server bundles.
  env: appUrl ? { NEXT_PUBLIC_APP_URL: appUrl } : {},
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
