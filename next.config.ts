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
  // HTTPS only from the first visit on (browsers ignore it over plain http, e.g. locally).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/(.*)", headers: SECURITY_HEADERS },
      // The service worker must always be fetched fresh, and may only load itself.
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
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
