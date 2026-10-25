import type { MetadataRoute } from "next";

import { brand } from "@/config/brand";
import { ROUTES } from "@/lib/auth/routes";

/** Web app manifest (SPEC §16): installable, opens on the dashboard. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: brand.name,
    short_name: brand.shortName,
    description: brand.description,
    start_url: ROUTES.dashboard,
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: brand.colors.themeLight,
    theme_color: brand.colors.primary,
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/logo.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
