// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCurrentUser, getProfile, requireLiveSession, requireOnboardedProfile, requireUser } from "@/server/auth";

// Review M6 M13: the identity helpers with Supabase Auth mocked.

const ME = "11111111-1111-4111-8111-111111111111";

const state = vi.hoisted(() => ({
  claims: null as { data: unknown; error: unknown } | null,
  user: null as { data: unknown; error: unknown } | null,
  profile: null as { data: unknown; error: unknown } | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: async () => state.claims, getUser: async () => state.user },
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq"]) chain[method] = () => chain;
      chain.maybeSingle = async () => state.profile;
      return chain;
    },
  }),
}));

const profileRow = (overrides: Record<string, unknown> = {}) => ({
  id: ME,
  email: "me@example.com",
  display_name: "Me",
  default_currency: "INR",
  timezone: "Asia/Kolkata",
  onboarded_at: "2026-10-01T00:00:00Z",
  deleted_at: null,
  ...overrides,
});

beforeEach(() => {
  state.claims = { data: { claims: { sub: ME, email: "me@example.com" } }, error: null };
  state.user = { data: { user: { id: ME, email: "me@example.com" } }, error: null };
  state.profile = { data: profileRow(), error: null };
});

describe("identity", () => {
  it("comes from verified claims", async () => {
    expect(await getCurrentUser()).toEqual({ id: ME, email: "me@example.com" });
    state.claims = { data: null, error: { message: "invalid JWT" } };
    expect(await getCurrentUser()).toBeNull();
    state.claims = { data: { claims: { email: "me@example.com" } }, error: null };
    expect(await getCurrentUser()).toBeNull();
  });

  it("requireUser sends a visitor to the login page", async () => {
    state.claims = { data: null, error: null };
    await expect(requireUser()).rejects.toThrow("REDIRECT:/login");
  });

  it("requireLiveSession asks Supabase Auth and sends an ended session to login", async () => {
    expect(await requireLiveSession()).toEqual({ id: ME, email: "me@example.com" });
    state.user = { data: { user: null }, error: { message: "Session not found" } };
    await expect(requireLiveSession()).rejects.toThrow("REDIRECT:/login");
  });
});

describe("profile", () => {
  it("returns the caller's profile without internal columns", async () => {
    const profile = await getProfile();
    expect(profile).toEqual({
      id: ME,
      email: "me@example.com",
      display_name: "Me",
      default_currency: "INR",
      timezone: "Asia/Kolkata",
      onboarded_at: "2026-10-01T00:00:00Z",
    });
  });

  it("ends the session of a deleted account", async () => {
    state.profile = { data: profileRow({ deleted_at: "2026-10-20T00:00:00Z" }), error: null };
    await expect(getProfile()).rejects.toThrow("REDIRECT:/login");
    state.profile = { data: null, error: null };
    await expect(getProfile()).rejects.toThrow("REDIRECT:/login");
  });

  it("hides the database error behind a generic message", async () => {
    state.profile = { data: null, error: { message: 'permission denied for table "profiles"' } };
    await expect(getProfile()).rejects.toThrow(/^Could not load your profile\.$/);
  });

  it("requireOnboardedProfile sends someone who hasn't finished onboarding there", async () => {
    state.profile = { data: profileRow({ onboarded_at: null }), error: null };
    await expect(requireOnboardedProfile()).rejects.toThrow("REDIRECT:/onboarding");
  });
});
