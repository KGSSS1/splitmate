// @vitest-environment node
import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { contextKey } from "@/lib/settlements/friend-view";
import { cancelSettlement, createSettlement, settleUpEverything } from "@/server/actions/settlements";

// Review M6 M13 / M15: the settle-up actions, with the database mocked. The
// direction → payer/receiver mapping was only covered by E2E.

const ME = "11111111-1111-4111-8111-111111111111";
const BINA = "22222222-2222-4222-8222-222222222222";
const CHETAN = "33333333-3333-4333-8333-333333333333";
const GROUP = "44444444-4444-4444-8444-444444444444";
const OTHER_GROUP = "55555555-5555-4555-8555-555555555555";
const SETTLEMENT = "66666666-6666-4666-8666-666666666666";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  rows: [] as unknown[],
  balances: [] as unknown[],
  friend: null as unknown,
  pending: new Set<string>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/server/auth", () => ({
  requireOnboardedProfile: async () => ({ id: ME }),
  requireLiveSession: async () => ({ id: ME, email: null }),
}));
vi.mock("@/server/balances", () => ({ getMyContextBalances: async () => state.balances }));
vi.mock("@/server/friends", () => ({ getFriend: async () => state.friend }));
vi.mock("@/server/settlements", () => ({ pendingContextKeysWith: async () => state.pending }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: state.rpc,
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "in", "eq"]) chain[method] = () => chain;
      chain.maybeSingle = async () => ({ data: state.rows[0] ?? null, error: null });
      chain.then = (resolve: (value: unknown) => void) => resolve({ data: state.rows, error: null });
      return chain;
    },
  }),
}));

const values = (overrides: Record<string, unknown> = {}) => ({
  personId: BINA,
  direction: "paid",
  amount: "250.50",
  currency: "INR",
  method: "cash",
  upiReference: "",
  note: "",
  settledOn: "2026-10-20",
  ...overrides,
});

beforeEach(() => {
  state.rpc.mockReset().mockResolvedValue({ data: SETTLEMENT, error: null });
  state.rows = [];
  state.balances = [];
  state.friend = null;
  state.pending = new Set();
});

describe("createSettlement", () => {
  it('"paid" records the viewer as payer, in minor units, and opens the settlement', async () => {
    const key = randomUUID();
    await expect(createSettlement({ idempotencyKey: key, groupId: GROUP, values: values() })).rejects.toThrow(
      `REDIRECT:/settlements/${SETTLEMENT}?saved=paid`,
    );
    expect(state.rpc).toHaveBeenCalledWith(
      "create_settlement",
      expect.objectContaining({
        p_idempotency_key: key,
        p_group_id: GROUP,
        p_payer_id: ME,
        p_receiver_id: BINA,
        p_amount: 25050,
        p_currency: "INR",
      }),
    );
  });

  it('"received" records the other person as payer', async () => {
    await expect(
      createSettlement({ idempotencyKey: randomUUID(), groupId: null, values: values({ direction: "received" }) }),
    ).rejects.toThrow("?saved=received");
    expect(state.rpc).toHaveBeenCalledWith(
      "create_settlement",
      expect.objectContaining({ p_group_id: null, p_payer_id: BINA, p_receiver_id: ME }),
    );
  });

  it("refuses the viewer as the other person without calling the database", async () => {
    const result = await createSettlement({ idempotencyKey: randomUUID(), groupId: GROUP, values: values({ personId: ME }) });
    expect(result).toEqual({ ok: false, error: "Choose someone other than yourself." });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("sends a UPI reference only for UPI payments", async () => {
    await createSettlement({
      idempotencyKey: randomUUID(),
      groupId: GROUP,
      values: values({ method: "cash", upiReference: "abc123" }),
    }).catch(() => {});
    expect(state.rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_upi_reference");
    await createSettlement({
      idempotencyKey: randomUUID(),
      groupId: GROUP,
      values: values({ method: "upi", upiReference: "abc123" }),
    }).catch(() => {});
    expect(state.rpc.mock.calls[1]?.[1]).toHaveProperty("p_upi_reference", "abc123");
  });

  it("returns a safe message when the database refuses", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "SM403", message: "You are not a member of this group" } });
    const result = await createSettlement({ idempotencyKey: randomUUID(), groupId: GROUP, values: values() });
    expect(result).toMatchObject({ ok: false, code: "SM403" });
  });

  it("rejects a bad idempotency key or amount before anything else", async () => {
    expect(await createSettlement({ idempotencyKey: "nope", groupId: GROUP, values: values() })).toMatchObject({ ok: false });
    expect(
      await createSettlement({ idempotencyKey: randomUUID(), groupId: GROUP, values: values({ amount: "1.234" }) }),
    ).toMatchObject({ ok: false, fieldErrors: { "values.amount": expect.any(String) } });
    expect(state.rpc).not.toHaveBeenCalled();
  });
});

describe("settleUpEverything", () => {
  const input = () => ({ idempotencyKey: randomUUID(), friendId: BINA, method: "cash", upiReference: "", note: "" });

  it("sends the server's own balances with that friend, leaving out unshared groups and pending ones", async () => {
    state.friend = { id: BINA, sharedGroups: [{ id: GROUP }] };
    state.balances = [
      { counterpartyId: BINA, groupId: GROUP, currency: "INR", amount: 45000, simplified: true },
      { counterpartyId: BINA, groupId: null, currency: "INR", amount: -25000, simplified: false },
      { counterpartyId: BINA, groupId: null, currency: "USD", amount: 700, simplified: false },
      // Not shared any more, someone else, and a context with a payment waiting.
      { counterpartyId: BINA, groupId: OTHER_GROUP, currency: "INR", amount: 100, simplified: false },
      { counterpartyId: CHETAN, groupId: GROUP, currency: "INR", amount: 999, simplified: true },
    ];
    state.pending = new Set([contextKey(null, "USD")]);
    state.rpc.mockResolvedValue({ data: ["a", "b"], error: null });
    state.rows = [
      { status: "completed", payer_id: BINA, amount: 45000, currency: "INR" },
      { status: "pending", payer_id: ME, amount: 25000, currency: "INR" },
    ];

    const result = await settleUpEverything(input());

    expect(state.rpc).toHaveBeenCalledWith(
      "settle_up_with_friend",
      expect.objectContaining({
        p_friend_id: BINA,
        p_items: [
          { group_id: GROUP, currency: "INR", amount: 45000 },
          { group_id: null, currency: "INR", amount: -25000 },
        ],
      }),
    );
    expect(result).toEqual({
      ok: true,
      message: "Recorded 2 settlements. Your payment of ₹250.00 is waiting for your friend to confirm it.",
    });
  });

  it("refuses someone who isn't a friend, and an empty balance, without calling the database", async () => {
    expect(await settleUpEverything(input())).toEqual({ ok: false, error: "You can only settle up with friends." });
    state.friend = { id: BINA, sharedGroups: [] };
    expect(await settleUpEverything(input())).toEqual({ ok: false, error: "There is nothing to settle with this friend." });
    expect(state.rpc).not.toHaveBeenCalled();
  });
});

describe("cancelSettlement", () => {
  it("says withdrawn for a pending payment and cancelled for a completed one", async () => {
    state.rpc.mockResolvedValue({ data: null, error: null });
    state.rows = [{ status: "withdrawn" }];
    expect(await cancelSettlement({ settlementId: SETTLEMENT })).toEqual({
      ok: true,
      message: "Payment withdrawn. Balances are unchanged.",
    });
    state.rows = [{ status: "cancelled" }];
    expect(await cancelSettlement({ settlementId: SETTLEMENT })).toEqual({
      ok: true,
      message: "Settlement cancelled and reversed.",
    });
    expect(state.rpc).toHaveBeenCalledWith("cancel_settlement", { p_settlement_id: SETTLEMENT });
  });
});
