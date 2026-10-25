import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import manifest from "@/app/manifest";
import { OfflineBanner } from "@/components/pwa/pwa";
import { brand } from "@/config/brand";
import { config } from "@/proxy";

describe("web app manifest", () => {
  const data = manifest();

  it("is installable: name, standalone display, start URL and theme colours", () => {
    expect(data).toMatchObject({
      name: brand.name,
      short_name: brand.shortName,
      display: "standalone",
      start_url: "/dashboard",
      theme_color: brand.colors.primary,
    });
  });

  it("has 192 and 512 px icons, a maskable one, and every file exists", () => {
    const icons = data.icons ?? [];
    expect(icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(icons.some((icon) => icon.purpose === "maskable")).toBe(true);
    for (const icon of icons) expect(existsSync(join(process.cwd(), "public", icon.src)), icon.src).toBe(true);
  });
});

describe("offline page", () => {
  it("is static: no scripts beyond a reload button, no data", () => {
    const html = readFileSync(join(process.cwd(), "public", "offline.html"), "utf8");
    expect(html).toContain("You're offline");
    expect(html).not.toMatch(/<script/i);
  });
});

describe("proxy matcher", () => {
  // Next.js compiles the matcher with path-to-regexp; the part inside "/(…)" is a plain RegExp.
  const pattern = new RegExp(`^${config.matcher[0]!.slice(1)}$`);

  it("lets the service worker, offline page and manifest load without a session", () => {
    for (const path of ["sw.js", "offline.html", "manifest.webmanifest", "icons/icon-192.png"]) {
      expect(pattern.test(path), path).toBe(false);
    }
  });

  it("still runs on app pages and route handlers", () => {
    for (const path of ["dashboard", "settings/export", "analytics/export", "notifications/unread-count"]) {
      expect(pattern.test(path), path).toBe(true);
    }
  });
});

describe("OfflineBanner", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("appears when the browser goes offline and leaves when it is back", () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<OfflineBanner />);
    expect(screen.queryByText(/You're offline/)).toBeNull();

    online.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toHaveTextContent("You're offline. You can look around, but nothing can be saved");

    online.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByText(/You're offline/)).toBeNull();
  });
});
