// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as exportCsv } from "@/app/(app)/analytics/export/route";
import { GET as unreadCount } from "@/app/(app)/notifications/unread-count/route";
import { NOTIFICATION_TYPES } from "@/lib/notifications/types";
import {
  markAllNotificationsRead,
  markNotificationsRead,
  saveNotificationPreferences,
} from "@/server/actions/notifications";
import { TooManyRowsError } from "@/server/analytics";

// M8: notification actions, the unread-count endpoint and the CSV export
// route, with the database mocked.

const ME = "11111111-1111-4111-8111-111111111111";
const NOTE = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  count: vi.fn(),
  refresh: vi.fn(),
  user: { id: "11111111-1111-4111-8111-111111111111", email: null } as { id: string; email: null } | null,
  buildExpensesCsv: vi.fn(),
  buildSettlementsCsv: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: state.refresh }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/server/auth", () => ({
  requireUser: async () => ({ id: ME, email: null }),
  getCurrentUser: async () => state.user,
  requireOnboardedProfile: async () => ({ id: ME, timezone: "Asia/Kolkata", default_currency: "INR" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: state.rpc,
    from: () => ({ select: () => ({ is: state.count }) }),
  }),
}));
vi.mock("@/server/exports", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/exports")>()),
  buildExpensesCsv: state.buildExpensesCsv,
  buildSettlementsCsv: state.buildSettlementsCsv,
}));

beforeEach(() => {
  state.rpc.mockReset().mockResolvedValue({ data: 1, error: null });
  state.count.mockReset().mockResolvedValue({ count: 4, error: null });
  state.refresh.mockReset();
  state.user = { id: ME, email: null };
  state.buildExpensesCsv.mockReset().mockResolvedValue({ fileName: "splitmate-expenses.csv", body: "﻿Date\r\n", rows: 0 });
  state.buildSettlementsCsv.mockReset().mockResolvedValue({ fileName: "splitmate-repayments.csv", body: "﻿Date\r\n", rows: 0 });
});

describe("notification actions", () => {
  it("mark chosen notifications read without refreshing the page", async () => {
    expect(await markNotificationsRead({ ids: [NOTE] })).toEqual({ ok: true });
    expect(state.rpc).toHaveBeenCalledWith("mark_notifications_read", { p_ids: [NOTE] });
    expect(state.refresh).not.toHaveBeenCalled();
  });

  it("refuse malformed or oversized ID lists before reaching the database", async () => {
    expect(await markNotificationsRead({ ids: ["not-a-uuid"] })).toMatchObject({ ok: false });
    expect(await markNotificationsRead({ ids: [] })).toMatchObject({ ok: false });
    expect(await markNotificationsRead({ ids: Array.from({ length: 101 }, () => NOTE) })).toMatchObject({ ok: false });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("mark everything read and refresh", async () => {
    expect(await markAllNotificationsRead()).toMatchObject({ ok: true });
    expect(state.rpc).toHaveBeenCalledWith("mark_notifications_read", {});
    expect(state.refresh).toHaveBeenCalled();
  });

  it("pass database errors on safely", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "SM401", message: "You must be signed in" } });
    expect(await markAllNotificationsRead()).toEqual({ ok: false, error: "You must be signed in.", code: "SM401" });
    state.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied for table notifications" } });
    const result = await markAllNotificationsRead();
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("permission denied");
  });

  it("save a complete set of preferences, and nothing partial or unknown", async () => {
    const all = Object.fromEntries(NOTIFICATION_TYPES.map((type) => [type, type !== "member_left"]));
    expect(await saveNotificationPreferences(all)).toMatchObject({ ok: true });
    expect(state.rpc).toHaveBeenCalledWith("set_notification_preferences", { p_preferences: all });

    state.rpc.mockClear();
    expect(await saveNotificationPreferences({ expense_added: false })).toMatchObject({ ok: false });
    expect(await saveNotificationPreferences({ ...all, expense_added: "no" })).toMatchObject({ ok: false });
    expect(state.rpc).not.toHaveBeenCalled();
  });
});

describe("unread count endpoint", () => {
  it("returns the signed-in user's count, never cached", async () => {
    const response = await unreadCount();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ unread: 4 });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("refuses signed-out requests and hides database errors", async () => {
    state.user = null;
    expect((await unreadCount()).status).toBe(401);
    state.user = { id: ME, email: null };
    state.count.mockResolvedValue({ count: null, error: { message: "relation does not exist" } });
    const response = await unreadCount();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("relation");
  });
});

describe("CSV export route", () => {
  const request = (query: string) => new Request(`http://localhost/analytics/export?${query}`);

  it("downloads expenses for the requested range as an uncached attachment", async () => {
    const response = await exportCsv(request("kind=expenses&range=custom&from=2026-01-01&to=2026-03-31"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="splitmate-expenses.csv"');
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(state.buildExpensesCsv).toHaveBeenCalledWith(expect.anything(), { from: "2026-01-01", to: "2026-03-31" });
  });

  it("downloads repayments for the signed-in user", async () => {
    await exportCsv(request("kind=settlements&range=this-year"));
    expect(state.buildSettlementsCsv).toHaveBeenCalledWith(expect.anything(), ME, expect.objectContaining({ from: expect.stringMatching(/-01-01$/) }));
  });

  it("rejects unknown exports and bad dates", async () => {
    expect((await exportCsv(request("kind=profiles"))).status).toBe(400);
    const bad = await exportCsv(request("range=custom&from=2026-05-01&to=2026-01-01"));
    expect(bad.status).toBe(400);
    expect(await bad.text()).toMatch(/start date/);
    expect(state.buildExpensesCsv).not.toHaveBeenCalled();
  });

  it("asks for a shorter range when there are too many rows, and hides other errors", async () => {
    state.buildExpensesCsv.mockRejectedValue(new TooManyRowsError());
    expect((await exportCsv(request("kind=expenses"))).status).toBe(413);
    state.buildExpensesCsv.mockRejectedValue(new Error("column e.secret does not exist"));
    const failed = await exportCsv(request("kind=expenses"));
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain("secret");
  });
});
