import { describe, expect, it } from "vitest";

import { getRouteAccess, ROUTES, safeNextPath } from "@/lib/auth/routes";

describe("getRouteAccess", () => {
  it.each([
    ["/", "guest"],
    ["/login", "guest"],
    ["/login/", "guest"],
    ["/signup", "guest"],
    ["/check-email", "guest"],
    ["/reset-password", "guest"],
    ["/auth/confirm", "public"],
    ["/reset-password/update", "protected"],
    ["/onboarding", "protected"],
    ["/dashboard", "protected"],
    ["/settings", "protected"],
    ["/groups/123", "protected"],
    ["/friends", "protected"],
    ["/invite/abc", "public"],
    ["/invite", "protected"],
    ["/no-such-page", "protected"],
    ["/loginx", "protected"],
  ] as const)("%s is %s", (path, access) => {
    expect(getRouteAccess(path)).toBe(access);
  });
});

describe("safeNextPath", () => {
  it("keeps same-origin protected paths, including the query", () => {
    expect(safeNextPath("/settings")).toBe("/settings");
    expect(safeNextPath("/groups/abc?tab=balances")).toBe("/groups/abc?tab=balances");
  });

  it("allows invitation links, which are public, so new members return to them", () => {
    expect(safeNextPath("/invite/abc_-123?group=0f0e")).toBe("/invite/abc_-123?group=0f0e");
  });

  it.each([
    [undefined],
    [null],
    [""],
    ["https://evil.example/dashboard"],
    ["//evil.example"],
    ["/\\evil.example"],
    ["/%0A//evil.example".replace("%0A", "\n")],
    ["dashboard"],
    ["/login"],
    ["/auth/confirm?token_hash=x"],
    ["/"],
    [`/${"a".repeat(2048)}`],
  ])("falls back to the dashboard for %j", (value) => {
    expect(safeNextPath(value)).toBe(ROUTES.dashboard);
  });
});
