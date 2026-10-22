import { parseSnapshot } from "@/lib/expenses/history";
import { addMinor } from "@/lib/money/amount";
import { isCurrencyCode } from "@/lib/money/currencies";
import { formatMoney } from "@/lib/money/format";

/** One `audit_events` row about an expense or a settlement, as read through RLS. */
export interface AuditEventRow {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  group_id: string | null;
  before: unknown;
  after: unknown;
  created_at: string;
}

export type ActivityTone = "positive" | "negative" | "neutral";

export interface ActivityItem {
  id: string;
  kind: "expense" | "settlement";
  entityId: string;
  groupId: string | null;
  at: string;
  /** "Asha added “Dinner”", "You confirmed Bina's payment of ₹100.00 to you". */
  title: string;
  /** What it means for the viewer, in words ("You owe ₹300.00"); null when nothing. */
  effect: string | null;
  tone: ActivityTone;
}

/** Expense and settlement actions shown in activity feeds (others, such as membership changes, are left out). */
export const ACTIVITY_ACTIONS = [
  "expense.created",
  "expense.updated",
  "expense.cancelled",
  "settlement.created",
  "settlement.confirmed",
  "settlement.rejected",
  "settlement.cancelled",
] as const;

type NameOf = (userId: string) => string;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** "You" for the viewer, otherwise their name. */
function who(userId: string | null, viewerId: string, nameOf: NameOf): string {
  if (!userId) return "Someone";
  return userId === viewerId ? "You" : nameOf(userId);
}

function whom(userId: string, viewerId: string, nameOf: NameOf): string {
  return userId === viewerId ? "you" : nameOf(userId);
}

function possessive(userId: string, viewerId: string, nameOf: NameOf): string {
  return userId === viewerId ? "your" : `${nameOf(userId)}'s`;
}

function describeExpense(row: AuditEventRow, viewerId: string, nameOf: NameOf): ActivityItem | null {
  const snapshot = parseSnapshot(row.after) ?? parseSnapshot(row.before);
  if (!snapshot) return null;
  const actor = who(row.actor_id, viewerId, nameOf);
  const verb = { "expense.created": "added", "expense.updated": "edited", "expense.cancelled": "cancelled" }[
    row.action as "expense.created" | "expense.updated" | "expense.cancelled"
  ];
  const title = `${actor} ${verb} “${snapshot.description}” (${formatMoney(snapshot.amount, snapshot.currency)})`;

  if (row.action === "expense.cancelled") {
    return base(row, "expense", title, "Its effect on balances was reversed", "neutral");
  }
  const mine = (rows: readonly { userId: string; amount: number }[]) =>
    rows.filter((row) => row.userId === viewerId).reduce((sum, row) => addMinor(sum, row.amount), 0);
  const involved = [...snapshot.payers, ...snapshot.participants].some((row) => row.userId === viewerId);
  const net = addMinor(mine(snapshot.payers), -mine(snapshot.participants));
  if (!involved) return base(row, "expense", title, null, "neutral");
  if (net > 0) return base(row, "expense", title, `You lent ${formatMoney(net, snapshot.currency)}`, "positive");
  if (net < 0) return base(row, "expense", title, `You owe ${formatMoney(-net, snapshot.currency)}`, "negative");
  return base(row, "expense", title, "Nothing owed", "neutral");
}

function describeSettlement(row: AuditEventRow, viewerId: string, nameOf: NameOf): ActivityItem | null {
  const data = isRecord(row.after) ? row.after : null;
  if (!data) return null;
  const { payer_id: payerId, receiver_id: receiverId, amount, currency } = data;
  if (
    typeof payerId !== "string" ||
    typeof receiverId !== "string" ||
    !Number.isSafeInteger(amount) ||
    typeof currency !== "string" ||
    !isCurrencyCode(currency)
  ) {
    return null;
  }
  const money = formatMoney(amount as number, currency);
  const actor = who(row.actor_id, viewerId, nameOf);
  // Only the receiver confirms or rejects, so "to whom" goes without saying there.
  const payment = `${possessive(payerId, viewerId, nameOf)} payment of ${money}`;

  switch (row.action) {
    case "settlement.created": {
      const pending = data.status === "pending";
      const title =
        row.actor_id === payerId
          ? `${actor} recorded paying ${whom(receiverId, viewerId, nameOf)} ${money}`
          : `${actor} recorded receiving ${money} from ${whom(payerId, viewerId, nameOf)}`;
      if (pending) {
        const effect = receiverId === viewerId ? "Waiting for you to confirm" : `Waiting for ${nameOf(receiverId)} to confirm`;
        return base(row, "settlement", title, effect, "neutral");
      }
      return base(row, "settlement", title, "Balances updated", "neutral");
    }
    case "settlement.confirmed":
      return base(row, "settlement", `${actor} confirmed ${payment}`, "Balances updated", "neutral");
    case "settlement.rejected":
      return base(row, "settlement", `${actor} rejected ${payment}`, "Balances unchanged", "neutral");
    case "settlement.cancelled": {
      const wasCompleted = isRecord(row.before) && row.before.status === "completed";
      const from = whom(payerId, viewerId, nameOf);
      const to = whom(receiverId, viewerId, nameOf);
      return base(
        row,
        "settlement",
        `${actor} cancelled the ${money} payment from ${from} to ${to}`,
        wasCompleted ? "Its effect on balances was reversed" : null,
        "neutral",
      );
    }
    default:
      return null;
  }
}

function base(
  row: AuditEventRow,
  kind: ActivityItem["kind"],
  title: string,
  effect: string | null,
  tone: ActivityTone,
): ActivityItem {
  return { id: row.id, kind, entityId: row.entity_id, groupId: row.group_id, at: row.created_at, title, effect, tone };
}

/**
 * An audit row in words, from the viewer's side. Rows it does not understand
 * (other actions, malformed JSON) give null and are left out of the feed.
 */
export function describeActivity(row: AuditEventRow, viewerId: string, nameOf: NameOf): ActivityItem | null {
  if (row.entity_type === "expense" && row.action.startsWith("expense.")) return describeExpense(row, viewerId, nameOf);
  if (row.entity_type === "settlement") return describeSettlement(row, viewerId, nameOf);
  return null;
}

/** Everyone an activity row mentions, so their names can be loaded in one call. */
export function activityPeople(row: AuditEventRow): string[] {
  const ids = new Set<string>();
  if (row.actor_id) ids.add(row.actor_id);
  for (const value of [row.before, row.after]) {
    if (!isRecord(value)) continue;
    if (typeof value.payer_id === "string") ids.add(value.payer_id);
    if (typeof value.receiver_id === "string") ids.add(value.receiver_id);
  }
  return [...ids];
}
