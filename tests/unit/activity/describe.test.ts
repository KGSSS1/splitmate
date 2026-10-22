import { describe, expect, it } from "vitest";

import { activityPeople, type AuditEventRow, describeActivity } from "@/lib/activity/describe";

const NAMES: Record<string, string> = { a: "Asha", b: "Bina", c: "Chetan" };
const nameOf = (id: string) => NAMES[id] ?? "Unknown member";

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  status: "active",
  description: "Dinner",
  amount: 90000,
  currency: "INR",
  expense_date: "2026-10-21",
  split_method: "equal",
  category: "food",
  payers: [{ user_id: "a", amount: 90000 }],
  participants: [
    { user_id: "a", amount: 30000 },
    { user_id: "b", amount: 30000 },
    { user_id: "c", amount: 30000 },
  ],
  ...overrides,
});

function row(overrides: Partial<AuditEventRow>): AuditEventRow {
  return {
    id: "event-1",
    actor_id: "a",
    action: "expense.created",
    entity_type: "expense",
    entity_id: "expense-1",
    group_id: "group-1",
    before: null,
    after: snapshot(),
    created_at: "2026-10-21T10:00:00Z",
    ...overrides,
  };
}

const settlement = (overrides: Record<string, unknown> = {}) => ({
  status: "pending",
  payer_id: "b",
  receiver_id: "a",
  amount: 10000,
  currency: "INR",
  method: "upi",
  ...overrides,
});

describe("describeActivity", () => {
  it("words an expense from each viewer's side, with what it means for them", () => {
    expect(describeActivity(row({}), "a", nameOf)).toMatchObject({
      kind: "expense",
      title: "You added “Dinner” (₹900.00)",
      effect: "You lent ₹600.00",
      tone: "positive",
    });
    expect(describeActivity(row({}), "b", nameOf)).toMatchObject({
      title: "Asha added “Dinner” (₹900.00)",
      effect: "You owe ₹300.00",
      tone: "negative",
    });
  });

  it("says nothing about money for someone not involved", () => {
    expect(describeActivity(row({}), "z", nameOf)).toMatchObject({ effect: null, tone: "neutral" });
  });

  it("edits and cancellations", () => {
    expect(describeActivity(row({ action: "expense.updated", actor_id: "b" }), "a", nameOf)?.title).toBe(
      "Bina edited “Dinner” (₹900.00)",
    );
    const cancelled = describeActivity(
      row({ action: "expense.cancelled", before: snapshot(), after: snapshot({ status: "cancelled" }) }),
      "b",
      nameOf,
    );
    expect(cancelled).toMatchObject({
      title: "Asha cancelled “Dinner” (₹900.00)",
      effect: "Its effect on balances was reversed",
    });
  });

  it("settlement recorded by the payer waits for the receiver", () => {
    const created = row({ entity_type: "settlement", action: "settlement.created", actor_id: "b", after: settlement() });
    expect(describeActivity(created, "b", nameOf)).toMatchObject({
      kind: "settlement",
      title: "You recorded paying Asha ₹100.00",
      effect: "Waiting for Asha to confirm",
    });
    expect(describeActivity(created, "a", nameOf)).toMatchObject({
      title: "Bina recorded paying you ₹100.00",
      effect: "Waiting for you to confirm",
    });
  });

  it("settlement recorded by the receiver, confirmed, rejected and cancelled", () => {
    const received = row({
      entity_type: "settlement",
      action: "settlement.created",
      actor_id: "a",
      after: settlement({ status: "completed" }),
    });
    expect(describeActivity(received, "c", nameOf)?.title).toBe("Asha recorded receiving ₹100.00 from Bina");
    expect(
      describeActivity(row({ entity_type: "settlement", action: "settlement.confirmed", after: settlement({ status: "completed" }) }), "b", nameOf)?.title,
    ).toBe("Asha confirmed your payment of ₹100.00");
    expect(
      describeActivity(row({ entity_type: "settlement", action: "settlement.rejected", after: settlement({ status: "rejected" }) }), "a", nameOf),
    ).toMatchObject({ title: "You rejected Bina's payment of ₹100.00", effect: "Balances unchanged" });
    expect(
      describeActivity(
        row({
          entity_type: "settlement",
          action: "settlement.cancelled",
          actor_id: "b",
          before: settlement({ status: "completed" }),
          after: settlement({ status: "cancelled" }),
        }),
        "a",
        nameOf,
      ),
    ).toMatchObject({ title: "Bina cancelled the ₹100.00 payment from Bina to you", effect: "Its effect on balances was reversed" });
  });

  it("skips rows it does not understand", () => {
    expect(describeActivity(row({ action: "member.joined", entity_type: "group_member" }), "a", nameOf)).toBeNull();
    expect(describeActivity(row({ after: { description: 5 } }), "a", nameOf)).toBeNull();
    expect(describeActivity(row({ entity_type: "settlement", action: "settlement.created", after: { amount: "x" } }), "a", nameOf)).toBeNull();
  });

  it("lists everyone a row mentions", () => {
    expect(activityPeople(row({ entity_type: "settlement", actor_id: "c", after: settlement() })).sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
