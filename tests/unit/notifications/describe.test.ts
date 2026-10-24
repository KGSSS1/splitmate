import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { describeNotification, type NotificationRow } from "@/lib/notifications/describe";
import {
  NOTIFICATION_SECTIONS,
  NOTIFICATION_TYPE_INFO,
  NOTIFICATION_TYPES,
  preferenceMap,
} from "@/lib/notifications/types";

const ASHA = "11111111-1111-4111-8111-111111111111";
const GROUP = "44444444-4444-4444-8444-444444444444";
const EXPENSE = "55555555-5555-4555-8555-555555555555";
const SETTLEMENT = "66666666-6666-4666-8666-666666666666";
const RECURRING = "77777777-7777-4777-8777-777777777777";

const context = {
  nameOf: (id: string) => (id === ASHA ? "Asha" : "Unknown member"),
  groupName: (id: string) => (id === GROUP ? "Goa trip" : null),
};

function row(type: string, overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: "n1",
    type,
    actor_id: ASHA,
    group_id: GROUP,
    expense_id: null,
    settlement_id: null,
    data: {},
    read_at: null,
    created_at: "2026-10-24T10:00:00Z",
    ...overrides,
  };
}

/** The notification types allowed by the latest migration that redefines the domain's check. */
function sqlNotificationTypes(): string[] {
  const dir = join(process.cwd(), "supabase", "migrations");
  const pattern = /notification_type[\s\S]{0,80}?check\s*\(\s*value\s+in\s*\(([^)]*)\)/gi;
  let types: string[] | undefined;
  for (const file of readdirSync(dir).sort()) {
    for (const match of readFileSync(join(dir, file), "utf8").matchAll(pattern)) {
      types = [...match[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    }
  }
  if (!types) throw new Error("No notification_type check found in supabase/migrations");
  return types;
}

describe("notification types", () => {
  it("match the database domain", () => {
    expect([...NOTIFICATION_TYPES].sort()).toEqual(sqlNotificationTypes().sort());
  });

  it("each have a preference label in a known section", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(NOTIFICATION_TYPE_INFO[type].label.length).toBeGreaterThan(0);
      expect(NOTIFICATION_SECTIONS).toContain(NOTIFICATION_TYPE_INFO[type].section);
    }
  });

  it("default to on when no preference row exists", () => {
    const map = preferenceMap([
      { type: "expense_added", in_app: false },
      { type: "not_a_type", in_app: false },
    ]);
    expect(map.expense_added).toBe(false);
    expect(map.expense_updated).toBe(true);
    expect(Object.keys(map)).toHaveLength(NOTIFICATION_TYPES.length);
  });
});

describe("describeNotification", () => {
  it("describes a new expense with its amount, group and link", () => {
    const item = describeNotification(
      row("expense_added", { expense_id: EXPENSE, data: { description: "Dinner", amount: 90000, currency: "INR" } }),
      context,
    );
    expect(item).toMatchObject({
      title: "Asha added “Dinner” (₹900.00) in Goa trip",
      href: `/expenses/${EXPENSE}`,
      read: false,
    });
  });

  it("says how an edit changed the amount, and nothing when it did not", () => {
    const changed = describeNotification(
      row("expense_updated", {
        expense_id: EXPENSE,
        data: { description: "Dinner", amount: 120000, currency: "INR", previous_amount: 90000, previous_currency: "INR" },
      }),
      context,
    );
    expect(changed?.title).toBe("Asha edited “Dinner” in Goa trip");
    expect(changed?.detail).toBe("Amount changed from ₹900.00 to ₹1,200.00");

    const same = describeNotification(
      row("expense_updated", {
        data: { description: "Dinner", amount: 90000, currency: "INR", previous_amount: 90000, previous_currency: "INR" },
      }),
      context,
    );
    expect(same?.detail).toBeNull();
  });

  it("asks the receiver to confirm a pending repayment, and words a recorded receipt differently", () => {
    const data = { status: "pending", amount: 10000, currency: "INR" };
    expect(describeNotification(row("settlement_recorded", { settlement_id: SETTLEMENT, data }), context)).toMatchObject({
      title: "Asha says they paid you ₹100.00 in Goa trip",
      detail: "Confirm or reject it",
      href: `/settlements/${SETTLEMENT}`,
    });
    expect(
      describeNotification(row("settlement_recorded", { data: { ...data, status: "completed" } }), context)?.title,
    ).toBe("Asha recorded receiving ₹100.00 from you in Goa trip");
  });

  it("tells a withdrawn repayment from a cancelled one", () => {
    const base = { amount: 10000, currency: "INR" };
    expect(describeNotification(row("settlement_cancelled", { data: { ...base, status: "withdrawn" } }), context)).toMatchObject({
      title: "Asha withdrew a pending payment of ₹100.00 in Goa trip",
      detail: "Balances unchanged",
    });
    expect(describeNotification(row("settlement_cancelled", { data: { ...base, status: "cancelled" } }), context)).toMatchObject({
      title: "Asha cancelled the ₹100.00 payment in Goa trip",
      detail: "Its effect on balances was reversed",
    });
  });

  it("links recurring notifications to the expense or the schedule", () => {
    const data = { description: "Rent", amount: 2000000, currency: "INR", recurring_expense_id: RECURRING, occurrence_date: "2026-10-01" };
    expect(describeNotification(row("recurring_created", { actor_id: null, expense_id: EXPENSE, data }), context)).toMatchObject({
      title: "“Rent” was added automatically for 1 Oct 2026 (₹20,000.00) in Goa trip",
      href: `/expenses/${EXPENSE}`,
    });
    expect(describeNotification(row("recurring_failed", { actor_id: null, data }), context)).toMatchObject({
      title: "“Rent” could not be added for 1 Oct 2026",
      href: `/recurring/${RECURRING}`,
    });
  });

  it("uses the invitation's stored group name when the viewer is not a member yet", () => {
    const item = describeNotification(
      row("group_invitation", { group_id: "99999999-9999-4999-8999-999999999999", data: { group_name: "Flat 4B" } }),
      context,
    );
    expect(item?.title).toBe("Asha invited you to Flat 4B");
    expect(item?.href).toBe("/groups");
  });

  it("covers friend and membership types", () => {
    expect(describeNotification(row("friend_accepted", { group_id: null }), context)?.href).toBe(`/friends/${ASHA}`);
    expect(describeNotification(row("friend_request", { group_id: null }), context)?.title).toBe(
      "Asha sent you a friend request",
    );
    expect(describeNotification(row("member_removed"), context)?.title).toBe("Asha removed you from Goa trip");
    expect(describeNotification(row("member_joined"), context)?.href).toBe(`/groups/${GROUP}`);
  });

  it("falls back to plain wording when data is malformed, and marks read rows", () => {
    const item = describeNotification(
      row("expense_added", { actor_id: null, group_id: null, data: { amount: 1.5, currency: "XXX" }, read_at: "2026-10-24T11:00:00Z" }),
      context,
    );
    expect(item).toMatchObject({ title: "Someone added an expense", href: "/activity", read: true });
  });

  it("describes every known type and skips unknown ones", () => {
    for (const type of NOTIFICATION_TYPES) expect(describeNotification(row(type), context), type).not.toBeNull();
    expect(describeNotification(row("something_new"), context)).toBeNull();
  });
});
