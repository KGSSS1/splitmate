// @vitest-environment node
import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { blankExpenseValues } from "@/lib/expenses/form-values";
import { NEUTRAL_REQUEST_MESSAGE } from "@/lib/friends/request-outcome";
import { addComment, createExpense, updateExpense } from "@/server/actions/expenses";
import { addFriend } from "@/server/actions/friends";

// Review M6 M13: expense and friend actions with the database mocked.

const ME = "11111111-1111-4111-8111-111111111111";
const BINA = "22222222-2222-4222-8222-222222222222";
const CHETAN = "33333333-3333-4333-8333-333333333333";
const GROUP = "44444444-4444-4444-8444-444444444444";
const EXPENSE = "55555555-5555-4555-8555-555555555555";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  insert: vi.fn(),
  personCards: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/server/auth", () => ({
  requireUser: async () => ({ id: ME, email: null }),
  requireOnboardedProfile: async () => ({ id: ME }),
}));
vi.mock("@/server/people", () => ({ getPersonCards: state.personCards }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: state.rpc, from: () => ({ insert: state.insert }) }),
}));

const values = (splitWith: string, userIds: string[], overrides: Record<string, unknown> = {}) => ({
  ...blankExpenseValues({ splitWith, userIds, paidBy: ME, currency: "INR", date: "2026-10-20" }),
  description: "  Dinner ",
  amount: "1000",
  ...overrides,
});

beforeEach(() => {
  state.rpc.mockReset().mockResolvedValue({ data: EXPENSE, error: null });
  state.insert.mockReset().mockResolvedValue({ error: null });
  state.personCards.mockReset().mockResolvedValue(new Map());
});

describe("createExpense", () => {
  it("works the shares out on the server and keeps the form's idempotency key", async () => {
    const key = randomUUID();
    await expect(
      createExpense({ idempotencyKey: key, values: values(`group:${GROUP}`, [ME, BINA, CHETAN]) }),
    ).rejects.toThrow(`REDIRECT:/expenses/${EXPENSE}?saved=created`);
    const [name, args] = state.rpc.mock.calls[0] ?? [];
    expect(name).toBe("create_expense");
    expect(args).toMatchObject({
      p_idempotency_key: key,
      p_group_id: GROUP,
      p_description: "Dinner",
      p_amount: 100000,
      p_split_method: "equal",
      p_payers: [{ user_id: ME, amount: 100000 }],
    });
    // ₹1,000 three ways: the shares add up exactly, one person gets the extra paisa.
    const shares = (args.p_participants as { amount: number }[]).map((share) => share.amount);
    expect(shares.reduce((sum, amount) => sum + amount, 0)).toBe(100000);
    expect([...shares].sort()).toEqual([33333, 33333, 33334]);
    expect(args.p_ledger_entries).toHaveLength(2);
  });

  it("ignores amounts sent by the browser", async () => {
    await createExpense({
      idempotencyKey: randomUUID(),
      values: { ...values(`group:${GROUP}`, [ME, BINA]), p_participants: [{ user_id: BINA, amount: 100000 }] },
    }).catch(() => {});
    const args = state.rpc.mock.calls[0]?.[1] as { p_participants: { user_id: string; amount: number }[] };
    expect(args.p_participants.map((share) => share.amount)).toEqual([50000, 50000]);
  });

  it("files a friend expense with no group", async () => {
    await createExpense({ idempotencyKey: randomUUID(), values: values(`friend:${BINA}`, [ME, BINA]) }).catch(() => {});
    expect(state.rpc.mock.calls[0]?.[1]).toMatchObject({ p_group_id: null });
  });

  it("sends nothing when the form is invalid", async () => {
    const result = await createExpense({ idempotencyKey: randomUUID(), values: values(`group:${GROUP}`, [ME], { amount: "" }) });
    expect(result).toMatchObject({ ok: false });
    expect(state.rpc).not.toHaveBeenCalled();
  });
});

describe("updateExpense", () => {
  it("says whether anything changed", async () => {
    const input = { expenseId: EXPENSE, expectedVersion: 3, values: values(`group:${GROUP}`, [ME, BINA]) };
    state.rpc.mockResolvedValue({ data: 4, error: null });
    await expect(updateExpense(input)).rejects.toThrow("?saved=updated");
    state.rpc.mockResolvedValue({ data: 3, error: null });
    await expect(updateExpense(input)).rejects.toThrow("?saved=unchanged");
    expect(state.rpc).toHaveBeenCalledWith("update_expense", expect.objectContaining({ p_expected_version: 3 }));
  });

  it("passes a stale-version conflict on as a safe message", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "SM409", message: "Someone else changed this expense" } });
    const result = await updateExpense({ expenseId: EXPENSE, expectedVersion: 1, values: values(`group:${GROUP}`, [ME, BINA]) });
    expect(result).toMatchObject({ ok: false, code: "SM409" });
  });
});

describe("addComment", () => {
  it("explains a refusal by RLS and hides other errors", async () => {
    state.insert.mockResolvedValue({ error: { code: "42501", message: "new row violates row-level security policy" } });
    expect(await addComment({ expenseId: EXPENSE, body: "Thanks" })).toEqual({
      ok: false,
      error: "You can't comment on this expense.",
    });
    state.insert.mockResolvedValue({ error: { code: "57014", message: "canceling statement due to statement timeout" } });
    expect(await addComment({ expenseId: EXPENSE, body: "Thanks" })).toEqual({
      ok: false,
      error: "Couldn't post your comment. Please try again.",
    });
    expect(state.insert).toHaveBeenCalledWith({ expense_id: EXPENSE, author_id: ME, body: "Thanks" });
  });
});

describe("addFriend", () => {
  it("gives the same reply whether or not the address has an account (L8)", async () => {
    state.rpc.mockResolvedValue({ data: [{ status: "sent", request_id: randomUUID(), friend_id: null }], error: null });
    expect(await addFriend({ email: "someone@example.com" })).toEqual({ ok: true, message: NEUTRAL_REQUEST_MESSAGE });
    expect(state.personCards).not.toHaveBeenCalled();
  });

  it("names the friend when they had already asked you", async () => {
    state.rpc.mockResolvedValue({ data: [{ status: "accepted", request_id: null, friend_id: BINA }], error: null });
    state.personCards.mockResolvedValue(new Map([[BINA, { displayName: "Bina" }]]));
    expect(await addFriend({ email: "bina@example.com" })).toMatchObject({ ok: true, message: expect.stringContaining("Bina") });
  });

  it("refuses your own address at the field", async () => {
    state.rpc.mockResolvedValue({ data: [{ status: "self", request_id: null, friend_id: null }], error: null });
    expect(await addFriend({ email: "me@example.com" })).toMatchObject({ ok: false, fieldErrors: { email: expect.any(String) } });
  });
});
