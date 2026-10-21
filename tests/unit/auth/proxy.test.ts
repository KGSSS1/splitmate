// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { updateSession } from "@/lib/supabase/proxy";

type CookieMethods = {
  setAll: (
    cookies: { name: string; value: string; options: Record<string, unknown> }[],
    headers: Record<string, string>,
  ) => void;
};

const auth = vi.hoisted(() => ({
  signedIn: false,
  /** Simulates a token refresh: getClaims() writes new cookies through setAll. */
  refresh: false,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: CookieMethods }) => ({
    auth: {
      getClaims: async () => {
        if (auth.refresh) {
          options.cookies.setAll([{ name: "sb-test-auth-token", value: "fresh", options: { path: "/" } }], {
            "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
          });
        }
        return { data: auth.signedIn ? { claims: { sub: "user-1" } } : null, error: null };
      },
    },
  }),
}));

function request(path: string) {
  return new NextRequest(new URL(path, "http://localhost:3100"));
}

describe("updateSession (src/proxy.ts)", () => {
  beforeAll(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3100");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  });

  beforeEach(() => {
    auth.signedIn = false;
    auth.refresh = false;
  });

  it("sends signed-out visitors of protected pages to login with a return path", async () => {
    const response = await updateSession(request("/groups/abc?tab=balances"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/groups/abc?tab=balances");
  });

  it("lets signed-out visitors see guest and public pages", async () => {
    for (const path of ["/", "/login", "/signup", "/reset-password", "/auth/confirm?token_hash=x&type=email"]) {
      const response = await updateSession(request(path));
      expect(response.headers.get("location"), path).toBeNull();
    }
  });

  it("sends signed-in users away from guest pages to the dashboard", async () => {
    auth.signedIn = true;
    const response = await updateSession(request("/login?next=/settings"));
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/dashboard");
  });

  it("lets signed-in users through to protected pages", async () => {
    auth.signedIn = true;
    const response = await updateSession(request("/settings"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("passes refreshed session cookies and no-store headers to the browser", async () => {
    auth.signedIn = true;
    auth.refresh = true;
    const response = await updateSession(request("/dashboard"));
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("fresh");
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("keeps refreshed cookies on redirects too", async () => {
    auth.signedIn = true;
    auth.refresh = true;
    const response = await updateSession(request("/login"));
    expect(response.headers.get("location")).toMatch(/\/dashboard$/);
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("fresh");
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
  });
});
