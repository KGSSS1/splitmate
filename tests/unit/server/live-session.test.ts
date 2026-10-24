// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { updatePassword } from "@/server/actions/auth";
import { leaveGroup, removeMember, setMemberRole } from "@/server/actions/groups";
import { cancelSettlement, confirmSettlement, rejectSettlement } from "@/server/actions/settlements";

// Review M6 L12: getClaims() checks the token locally, so a session ended by
// logging out keeps working until its token expires. Sensitive actions must also
// ask Supabase Auth (getUser), and do nothing when the session is gone.

const ME = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({ sessionAlive: true, rpc: vi.fn(), updateUser: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: ME, email: "me@example.com" } }, error: null }),
      getUser: async () =>
        state.sessionAlive
          ? { data: { user: { id: ME, email: "me@example.com" } }, error: null }
          : { data: { user: null }, error: { message: "Session from session_id claim in JWT does not exist" } },
      updateUser: state.updateUser,
    },
    rpc: state.rpc,
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "in"]) chain[m] = () => chain;
      chain.maybeSingle = async () => ({
        data: {
          id: ME,
          email: "me@example.com",
          display_name: "Me",
          default_currency: "INR",
          timezone: "Asia/Kolkata",
          onboarded_at: "2026-10-01T00:00:00Z",
          deleted_at: null,
        },
        error: null,
      });
      return chain;
    },
  }),
}));

const actions: [string, () => Promise<unknown>][] = [
  ["confirmSettlement", () => confirmSettlement({ settlementId: ID })],
  ["rejectSettlement", () => rejectSettlement({ settlementId: ID })],
  ["cancelSettlement", () => cancelSettlement({ settlementId: ID })],
  ["removeMember", () => removeMember({ groupId: ID, userId: ME })],
  ["leaveGroup", () => leaveGroup({ groupId: ID })],
  ["setMemberRole", () => setMemberRole({ groupId: ID, userId: ME, role: "admin" })],
  ["updatePassword", () => updatePassword({ password: "a-new-password-1", confirmPassword: "a-new-password-1" })],
];

describe("sensitive actions need a live session", () => {
  beforeEach(() => {
    state.rpc.mockReset().mockResolvedValue({ data: null, error: null });
    state.updateUser.mockReset().mockResolvedValue({ data: {}, error: null });
  });

  it.each(actions)("%s refuses a logged-out session without touching the database", async (_name, run) => {
    state.sessionAlive = false;
    await expect(run()).rejects.toThrow("REDIRECT:/login");
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.updateUser).not.toHaveBeenCalled();
  });

  it.each(actions)("%s still works for a live session", async (_name, run) => {
    state.sessionAlive = true;
    await run().catch((error: Error) => {
      // Some actions redirect on success; that's fine.
      if (!error.message.startsWith("REDIRECT:")) throw error;
    });
    expect(state.rpc.mock.calls.length + state.updateUser.mock.calls.length).toBe(1);
  });
});
