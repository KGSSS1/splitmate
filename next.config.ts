import type { NextConfig } from "next";

import { validateEnv } from "./src/lib/env";

// Fail fast on missing or misplaced environment variables (SPEC §18).
// `next typegen` (run by `npm run typecheck`) also loads this file but needs no env.
if (!process.argv.includes("typegen")) {
  validateEnv(process.env);
}

const nextConfig: NextConfig = {
  cacheComponents: true,
  // The default bottom-left dev badge covers the sidebar's Log out button.
  devIndicators: { position: "bottom-right" },
  partialPrefetching: true,
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
