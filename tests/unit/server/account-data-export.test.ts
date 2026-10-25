// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as exportData } from "@/app/(app)/settings/export/route";
import { getRouteAccess } from "@/lib/auth/routes";
import { deleteAccount } from "@/server/actions/account";
import { buildDatasetCsv, EXPORT_DATASETS, isExportDataset, MAX_EXPORT_ROWS } from "@/server/data-export";

// M9: account deletion and the data export, with the database mocked.

const ME = "11111111-1111-4111-8111-111111111111";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  pages: [] as Record<string, unknown>[][],
  ranges: [] as [number, number][],
  signOut: vi.fn(),
  cookieNames: ["sb-127-auth-token", "sb-127-auth-token.1", "theme"],
  deleted: [] as string[],
  liveSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => state.cookieNames.map((name) => ({ name, value: "x" })),
    delete: (name: string) => state.deleted.push(name),
  }),
}));
vi.mock("@/server/auth", () => ({
  requireLiveSession: state.liveSession,
}));
vi.mock("@/server/people", () => ({
  getPersonCards: async () => new Map([[ME, { id: ME, displayName: "Asha" }]]),
  getGroupNames: async () => new Map(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: state.rpc,
    auth: { signOut: state.signOut },
    from: () => {
      const query = {
        select: () => query,
        order: () => query,
        range: async (from: number, to: number) => {
          state.ranges.push([from, to]);
          return { data: state.pages.shift() ?? [], error: null };
        },
      };
      return query;
    },
  }),
}));

beforeEach(() => {
  state.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  state.signOut.mockReset().mockResolvedValue({ error: null });
  state.liveSession.mockReset().mockResolvedValue({ id: ME, email: null });
  state.pages = [];
  state.ranges = [];
  state.deleted = [];
});

describe("deleteAccount", () => {
  it("needs the word DELETE before reaching the database", async () => {
    expect(await deleteAccount({ confirmation: "delete" })).toMatchObject({
      ok: false,
      fieldErrors: { confirmation: "Type DELETE to confirm." },
    });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("checks the session is still live (not just a valid token)", async () => {
    state.liveSession.mockRejectedValue(new Error("REDIRECT:/login"));
    await expect(deleteAccount({ confirmation: "DELETE" })).rejects.toThrow("REDIRECT:/login");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("passes on 'settle up first' and keeps the user signed in", async () => {
    state.rpc.mockResolvedValue({
      data: null,
      error: { code: "SM409", message: "Settle up first: you still have a balance in a group" },
    });
    expect(await deleteAccount({ confirmation: " DELETE " })).toEqual({
      ok: false,
      error: "Settle up first: you still have a balance in a group.",
      code: "SM409",
    });
    expect(state.signOut).not.toHaveBeenCalled();
  });

  it("deletes, drops this browser's session cookies and goes to the goodbye page", async () => {
    await expect(deleteAccount({ confirmation: "DELETE" })).rejects.toThrow("REDIRECT:/account-deleted");
    expect(state.rpc).toHaveBeenCalledWith("delete_my_account", { p_confirmation: "DELETE" });
    expect(state.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(state.deleted).toEqual(["sb-127-auth-token", "sb-127-auth-token.1"]);
  });

  it("the goodbye page is for signed-out visitors", () => {
    expect(getRouteAccess("/account-deleted")).toBe("guest");
  });
});

describe("data export", () => {
  it("knows its datasets and refuses others", () => {
    expect(isExportDataset("expenses")).toBe(true);
    expect(isExportDataset("group_invitations")).toBe(false);
    expect(isExportDataset("toString")).toBe(false);
    expect(Object.values(EXPORT_DATASETS).map((dataset) => dataset.table)).not.toContain("group_invitations");
  });

  it("reads every page and adds decimal amounts to the CSV", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ id: `e${i}`, amount: 90000, currency: "INR", tags: ["trip"] }));
    state.pages = [full, [{ id: "last", amount: 1500, currency: "JPY", tags: [] }]];
    const csv = await buildDatasetCsv(await (await import("@/lib/supabase/server")).createClient(), "expenses");
    const lines = csv.replace(/^﻿/, "").trimEnd().split("\r\n");
    expect(state.ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(lines[0]).toBe("id,amount,currency,tags,amount_decimal");
    expect(lines[1]).toBe('e0,90000,INR,"[""trip""]",900.00');
    expect(lines.at(-1)).toBe("last,1500,JPY,[],1500");
  });

  it("stops at the row cap instead of growing without bound", async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    state.pages = Array.from({ length: MAX_EXPORT_ROWS / 1000 + 1 }, () => page);
    const response = await exportData(new Request("http://localhost/settings/export?format=csv&dataset=ledger_entries"));
    expect(response.status).toBe(413);
  });

  it("sends JSON as an uncached attachment, after checking the session", async () => {
    const response = await exportData(new Request("http://localhost/settings/export?format=json"));
    expect(state.liveSession).toHaveBeenCalled();
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="splitmate-export-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = JSON.parse(await response.text());
    expect(body).toMatchObject({ format: "splitmate-export", version: 1 });
    expect(Object.keys(body.data).sort()).toEqual(Object.keys(EXPORT_DATASETS).sort());
  });

  it("rejects unknown formats and datasets", async () => {
    expect((await exportData(new Request("http://localhost/settings/export?format=xml"))).status).toBe(400);
    expect((await exportData(new Request("http://localhost/settings/export?format=csv&dataset=auth.users"))).status).toBe(400);
  });
});
