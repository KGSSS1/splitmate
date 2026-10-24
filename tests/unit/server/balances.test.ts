// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getBalanceSummary, getGroupSuggestions, listPersonBalances, loadContextBalances } from "@/server/balances";

// Review M6 M13 / M14: the server's balance module with the database mocked.
// Asha, Bina and Chetan: Asha paid ₹300 for all three, Chetan ₹600 for Bina and himself.
// Raw: Bina owes Asha ₹100 and Chetan ₹300, Chetan owes Asha ₹100.
// Nets: Asha +₹200, Bina −₹400, Chetan +₹200, so the plan is two payments from Bina.

const ASHA = "11111111-1111-4111-8111-111111111111";
const BINA = "22222222-2222-4222-8222-222222222222";
const CHETAN = "33333333-3333-4333-8333-333333333333";
const GROUP = "44444444-4444-4444-8444-444444444444";

const state = vi.hoisted(() => ({
  results: {} as Record<string, { data: unknown; error: unknown }>,
  calls: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth", () => ({ requireUser: async () => ({ id: "11111111-1111-4111-8111-111111111111", email: null }) }));
vi.mock("@/server/people", () => ({
  getGroupNames: async () => new Map(),
  getPersonCards: async () =>
    new Map([
      ["22222222-2222-4222-8222-222222222222", { displayName: "Bina" }],
      ["33333333-3333-4333-8333-333333333333", { displayName: "Chetan" }],
    ]),
  nameOf: (cards: Map<string, { displayName: string }>, id: string) => cards.get(id)?.displayName ?? "Someone",
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (name: string) => {
      state.calls.push(name);
      return state.results[name] ?? { data: [], error: null };
    },
  }),
}));

const NETS = [
  { user_id: ASHA, currency: "INR", amount: 20000 },
  { user_id: BINA, currency: "INR", amount: -40000 },
  { user_id: CHETAN, currency: "INR", amount: 20000 },
];
const PAIRWISE = [
  { debtor_id: BINA, creditor_id: ASHA, currency: "INR", amount: 10000 },
  { debtor_id: BINA, creditor_id: CHETAN, currency: "INR", amount: 30000 },
  { debtor_id: CHETAN, creditor_id: ASHA, currency: "INR", amount: 10000 },
];

beforeEach(() => {
  state.calls.length = 0;
  state.results = { group_balances: { data: NETS, error: null }, group_pairwise_balances: { data: PAIRWISE, error: null } };
});

describe("getGroupSuggestions", () => {
  it("with Simplify debts on, suggests the simplified plan from members' nets", async () => {
    const transfers = await getGroupSuggestions(GROUP, true);
    expect(state.calls).toEqual(["group_balances"]);
    expect(transfers).toHaveLength(2);
    expect(transfers).toEqual(
      expect.arrayContaining([
        { fromUserId: BINA, toUserId: ASHA, currency: "INR", amount: 20000 },
        { fromUserId: BINA, toUserId: CHETAN, currency: "INR", amount: 20000 },
      ]),
    );
  });

  it("with it off, suggests who owes whom directly", async () => {
    const transfers = await getGroupSuggestions(GROUP, false);
    expect(state.calls).toEqual(["group_pairwise_balances"]);
    expect(transfers).toHaveLength(3);
    expect(transfers).toEqual(
      expect.arrayContaining([
        { fromUserId: BINA, toUserId: ASHA, currency: "INR", amount: 10000 },
        { fromUserId: BINA, toUserId: CHETAN, currency: "INR", amount: 30000 },
        { fromUserId: CHETAN, toUserId: ASHA, currency: "INR", amount: 10000 },
      ]),
    );
  });

  it("fails without leaking the database error", async () => {
    state.results.group_pairwise_balances = { data: null, error: { message: "relation does not exist" } };
    await expect(getGroupSuggestions(GROUP, false)).rejects.toThrow("Could not load group balances.");
  });
});

describe("loadContextBalances and the totals built on it", () => {
  beforeEach(() => {
    // Asha's view: the group simplifies, and Asha has a direct balance with Chetan.
    state.results.my_pairwise_balances = {
      data: [
        { friend_id: BINA, group_id: GROUP, currency: "INR", amount: 10000, simplified: true },
        { friend_id: CHETAN, group_id: GROUP, currency: "INR", amount: 10000, simplified: true },
        { friend_id: CHETAN, group_id: null, currency: "INR", amount: -5000, simplified: false },
      ],
      error: null,
    };
    state.results.my_simplified_group_balances = {
      data: NETS.map((row) => ({ group_id: GROUP, ...row })),
      error: null,
    };
  });

  it("uses the group's plan for simplifying groups and raw rows for direct balances", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    const rows = await loadContextBalances(await createClient(), ASHA);
    expect(rows).toEqual(
      expect.arrayContaining([
        { counterpartyId: BINA, groupId: GROUP, currency: "INR", amount: 20000, simplified: true },
        { counterpartyId: CHETAN, groupId: null, currency: "INR", amount: -5000, simplified: false },
      ]),
    );
    // In the plan Chetan pays nobody and nobody pays Chetan's way to Asha.
    expect(rows.filter((row) => row.counterpartyId === CHETAN && row.groupId === GROUP)).toEqual([]);
  });

  it("adds contexts up per person and per currency for the dashboard", async () => {
    expect(await getBalanceSummary()).toEqual([{ currency: "INR", owedToYou: 20000, youOwe: 5000, net: 15000 }]);
    expect(await listPersonBalances()).toEqual([
      { personId: BINA, displayName: "Bina", balances: [{ currency: "INR", amount: 20000 }] },
      { personId: CHETAN, displayName: "Chetan", balances: [{ currency: "INR", amount: -5000 }] },
    ]);
  });

  it("refuses to show partial balances when one read fails", async () => {
    state.results.my_simplified_group_balances = { data: null, error: { message: "timeout" } };
    const { createClient } = await import("@/lib/supabase/server");
    await expect(loadContextBalances(await createClient(), ASHA)).rejects.toThrow("Could not load your balances.");
  });
});
