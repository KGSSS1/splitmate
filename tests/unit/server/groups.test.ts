// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listMyGroups } from "@/server/groups";

// Review M6 (F2): the dashboard, /groups and /settle-up called group_balances
// once per group. listMyGroups must load the caller's balances in one call.

const ME = "11111111-1111-4111-8111-111111111111";
const groups = ["a", "b", "c"].map((letter, index) => ({
  id: `0000000${index}-0000-4000-8000-00000000000${index}`,
  name: `Group ${letter}`,
  description: null,
  group_type: "trip",
  default_currency: "INR",
  simplify_debts: true,
}));

const calls = vi.hoisted(() => ({ rpc: [] as { name: string; args: unknown }[], from: [] as string[] }));
const tableResults = vi.hoisted(() => [] as { data: unknown; error: null }[]);

/** A PostgREST-like builder: every filter returns itself; awaiting it gives the next queued result. */
function builder(result: { data: unknown; error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "order", "limit", "range", "or", "gt"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (value: unknown) => void) => resolve(result);
  return chain;
}

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth", () => ({ requireUser: async () => ({ id: ME, email: null }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      calls.from.push(table);
      return builder(tableResults.shift() ?? { data: [], error: null });
    },
    rpc: async (name: string, args: unknown) => {
      calls.rpc.push({ name, args });
      if (name === "my_group_balances") {
        return {
          data: [
            { group_id: groups[0]!.id, currency: "INR", amount: 30000 },
            { group_id: groups[2]!.id, currency: "USD", amount: -1250 },
            // A group the caller has left: ignored.
            { group_id: "99999999-9999-4999-8999-999999999999", currency: "INR", amount: 500 },
          ],
          error: null,
        };
      }
      // The per-group function: one row for the caller in whichever group was asked.
      return { data: [{ user_id: ME, currency: "INR", amount: 1 }], error: null };
    },
  }),
}));

describe("listMyGroups", () => {
  beforeEach(() => {
    calls.rpc.length = 0;
    calls.from.length = 0;
    tableResults.length = 0;
    tableResults.push(
      { data: groups.map((group) => ({ groups: group })), error: null },
      { data: groups.flatMap((group) => [{ group_id: group.id }, { group_id: group.id }]), error: null },
    );
  });

  it("loads the caller's balances for all groups in one call, whatever the number of groups", async () => {
    const result = await listMyGroups();
    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0]?.name).toBe("my_group_balances");
    expect(result.map((group) => [group.name, group.memberCount, group.myBalances])).toEqual([
      ["Group a", 2, [{ currency: "INR", amount: 30000 }]],
      ["Group b", 2, []],
      ["Group c", 2, [{ currency: "USD", amount: -1250 }]],
    ]);
  });
});
