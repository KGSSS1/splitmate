// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signOut } from "@/server/actions/auth";
import { changePermission } from "@/server/expenses";

// Review M6 L26: errors that were ignored.

const ME = "11111111-1111-4111-8111-111111111111";
const BINA = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  signOut: vi.fn(),
  cookies: [] as { name: string }[],
  deleted: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => state.cookies,
    delete: (name: string) => state.deleted.push(name),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signOut: state.signOut } }),
}));

function failingClient() {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is"]) chain[method] = () => chain;
  chain.maybeSingle = async () => ({ data: null, error: { message: "canceling statement due to statement timeout" } });
  return { from: () => chain } as unknown as Parameters<typeof changePermission>[0];
}

beforeEach(() => {
  state.signOut.mockReset();
  state.cookies = [];
  state.deleted = [];
});

describe("changePermission", () => {
  it("fails loudly when the friendship can't be read, instead of saying you're no longer friends", async () => {
    await expect(
      changePermission(failingClient(), ME, { status: "active", group_id: null }, [ME, BINA]),
    ).rejects.toThrow("Could not load this expense.");
  });
});

describe("signOut", () => {
  it("ends this browser's session", async () => {
    state.signOut.mockResolvedValue({ error: null });
    await expect(signOut()).rejects.toThrow("REDIRECT:/login");
    expect(state.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(state.deleted).toEqual([]);
  });

  it("still forgets the session in this browser when Supabase Auth can't be reached", async () => {
    state.signOut.mockResolvedValue({ error: { name: "AuthRetryableFetchError", message: "fetch failed" } });
    state.cookies = [{ name: "sb-127-auth-token.0" }, { name: "sb-127-auth-token.1" }, { name: "theme" }];
    await expect(signOut()).rejects.toThrow("REDIRECT:/login");
    expect(state.deleted).toEqual(["sb-127-auth-token.0", "sb-127-auth-token.1"]);
  });
});
