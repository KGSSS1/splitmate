import { ROUTES } from "@/lib/auth/routes";
import { formatExpenseDate } from "@/lib/expenses/dates";
import { isCurrencyCode } from "@/lib/money/currencies";
import { formatMoney } from "@/lib/money/format";

import { isNotificationType, type NotificationType } from "./types";

/** One `notifications` row, as read through RLS (the viewer's own). */
export interface NotificationRow {
  id: string;
  type: string;
  actor_id: string | null;
  group_id: string | null;
  expense_id: string | null;
  settlement_id: string | null;
  data: unknown;
  read_at: string | null;
  created_at: string;
}

export interface NotificationItem {
  id: string;
  type: NotificationType;
  /** "Asha added “Dinner” (₹900.00) in Flat 4B". */
  title: string;
  /** A second line when there is more to say ("Confirm or reject it"). */
  detail: string | null;
  /** Where the notification leads. */
  href: string;
  at: string;
  read: boolean;
}

export interface DescribeContext {
  /** Display name for someone the viewer can see; a fallback otherwise. */
  nameOf: (userId: string) => string;
  /** Name of a group the viewer is or was in; null when unknown. */
  groupName: (groupId: string) => string | null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** "₹900.00" from the stored amount and currency, or null if either is malformed. */
function money(amount: unknown, currency: unknown): string | null {
  if (!Number.isSafeInteger(amount) || typeof currency !== "string" || !isCurrencyCode(currency)) return null;
  return formatMoney(amount as number, currency);
}

/**
 * A notification in words, for its recipient. Every `data` field is checked,
 * since it is JSON written over several migrations; anything missing falls back
 * to plainer wording rather than hiding the notification. Unknown types give
 * null and are left out.
 */
export function describeNotification(row: NotificationRow, context: DescribeContext): NotificationItem | null {
  if (!isNotificationType(row.type)) return null;
  const data = record(row.data);
  const actor = row.actor_id ? context.nameOf(row.actor_id) : "Someone";
  const group = row.group_id ? (context.groupName(row.group_id) ?? text(data.group_name)) : null;
  const inGroup = group ? ` in ${group}` : "";
  const description = text(data.description);
  const quoted = description ? `“${description}”` : "an expense";
  const amount = money(data.amount, data.currency);
  const withAmount = (base: string) => (amount ? `${base} (${amount})` : base);

  const expenseHref = row.expense_id ? `${ROUTES.expenses}/${row.expense_id}` : ROUTES.activity;
  const settlementHref = row.settlement_id ? `${ROUTES.settlements}/${row.settlement_id}` : ROUTES.settlements;
  const groupHref = row.group_id ? `${ROUTES.groups}/${row.group_id}` : ROUTES.groups;
  const recurringId = text(data.recurring_expense_id);
  const recurringHref = recurringId ? `${ROUTES.recurring}/${recurringId}` : ROUTES.recurring;
  const occurrence = text(data.occurrence_date);
  const onDate = occurrence ? ` for ${formatExpenseDate(occurrence)}` : "";

  const item = (title: string, detail: string | null, href: string): NotificationItem => ({
    id: row.id,
    type: row.type as NotificationType,
    title,
    detail,
    href,
    at: row.created_at,
    read: row.read_at !== null,
  });

  switch (row.type) {
    case "expense_added":
      return item(withAmount(`${actor} added ${quoted}`) + inGroup, null, expenseHref);
    case "expense_updated": {
      const before = money(data.previous_amount, data.previous_currency);
      const changed = before && amount && before !== amount ? `Amount changed from ${before} to ${amount}` : null;
      return item(`${actor} edited ${quoted}${inGroup}`, changed, expenseHref);
    }
    case "expense_cancelled":
      return item(withAmount(`${actor} cancelled ${quoted}`) + inGroup, "Its effect on balances was reversed", expenseHref);
    case "recurring_created":
      return item(withAmount(`${quoted} was added automatically${onDate}`) + inGroup, "From a recurring expense", expenseHref);
    case "recurring_failed":
      return item(
        `${quoted} could not be added${onDate}`,
        "The recurring expense was paused",
        recurringHref,
      );
    case "settlement_recorded": {
      const what = amount ?? "a payment";
      if (data.status === "pending") {
        return item(`${actor} says they paid you ${what}${inGroup}`, "Confirm or reject it", settlementHref);
      }
      return item(`${actor} recorded receiving ${what} from you${inGroup}`, "Balances updated", settlementHref);
    }
    case "settlement_confirmed":
      return item(`${actor} confirmed your payment of ${amount ?? "money"}${inGroup}`, "Balances updated", settlementHref);
    case "settlement_rejected":
      return item(`${actor} rejected your payment of ${amount ?? "money"}${inGroup}`, "Balances unchanged", settlementHref);
    case "settlement_cancelled":
      if (data.status === "cancelled") {
        return item(
          `${actor} cancelled ${amount ? `the ${amount} payment` : "a payment"}${inGroup}`,
          "Its effect on balances was reversed",
          settlementHref,
        );
      }
      return item(
        `${actor} withdrew a pending payment${amount ? ` of ${amount}` : ""}${inGroup}`,
        "Balances unchanged",
        settlementHref,
      );
    case "group_invitation":
      return item(`${actor} invited you to ${group ?? "a group"}`, "Accept or decline it on the Groups page", ROUTES.groups);
    case "member_joined":
      return item(`${actor} joined ${group ?? "your group"}`, null, groupHref);
    case "member_left":
      return item(`${actor} left ${group ?? "a group"}`, null, groupHref);
    case "member_removed":
      return item(`${actor} removed you from ${group ?? "a group"}`, "You can still see your history there", groupHref);
    case "friend_request":
      return item(`${actor} sent you a friend request`, "Accept or decline it on the Friends page", ROUTES.friends);
    case "friend_accepted":
      return item(
        `${actor} accepted your friend request`,
        null,
        row.actor_id ? `${ROUTES.friends}/${row.actor_id}` : ROUTES.friends,
      );
  }
}

/** Everyone a notification names, so their names can be loaded in one call. */
export function notificationPeople(row: NotificationRow): string[] {
  return row.actor_id ? [row.actor_id] : [];
}
