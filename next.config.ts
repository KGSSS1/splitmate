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

// Review M6 L14: no framing by other sites (clickjacking on Confirm / Join), no MIME
// sniffing, and referrers limited to the origin across sites. A full content policy
// (scripts, styles) needs nonces and is a separate piece of work.
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
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
