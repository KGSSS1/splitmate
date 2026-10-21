/**
 * Single source for product identity (SPEC §2 "Branding").
 * The matching CSS color tokens live in src/app/globals.css (--primary);
 * keep them in sync when changing `colors`.
 */
export const brand = {
  name: "SplitMate",
  shortName: "SplitMate",
  tagline: "Share expenses. Settle up fairly.",
  description:
    "Track shared expenses with friends and groups, see exactly who owes whom, and settle up.",
  logo: {
    src: "/icons/logo.svg",
    alt: "SplitMate logo",
  },
  colors: {
    primary: "#15803d",
    primaryDark: "#22c55e",
    themeLight: "#ffffff",
    themeDark: "#0a0a0a",
  },
} as const;
