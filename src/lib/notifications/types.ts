/**
 * Notification types, in the order the preferences form lists them. Must match
 * the `public.notification_type` domain (a unit test compares them).
 */
export const NOTIFICATION_TYPES = [
  "expense_added",
  "expense_updated",
  "expense_cancelled",
  "recurring_created",
  "recurring_failed",
  "settlement_recorded",
  "settlement_confirmed",
  "settlement_rejected",
  "settlement_cancelled",
  "group_invitation",
  "member_joined",
  "member_left",
  "member_removed",
  "friend_request",
  "friend_accepted",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === "string" && (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

export interface NotificationTypeInfo {
  /** Preference label: what you are told about. */
  label: string;
  section: NotificationSection;
}

export const NOTIFICATION_SECTIONS = ["Expenses", "Repayments", "Groups", "Friends"] as const;
export type NotificationSection = (typeof NOTIFICATION_SECTIONS)[number];

export const NOTIFICATION_TYPE_INFO: Record<NotificationType, NotificationTypeInfo> = {
  expense_added: { label: "Someone adds an expense you're part of", section: "Expenses" },
  expense_updated: { label: "Someone edits an expense you're part of", section: "Expenses" },
  expense_cancelled: { label: "Someone cancels an expense you're part of", section: "Expenses" },
  recurring_created: { label: "A recurring expense is added automatically", section: "Expenses" },
  recurring_failed: { label: "A recurring expense you set up could not be added", section: "Expenses" },
  settlement_recorded: { label: "Someone records a repayment with you", section: "Repayments" },
  settlement_confirmed: { label: "Your repayment is confirmed", section: "Repayments" },
  settlement_rejected: { label: "Your repayment is rejected", section: "Repayments" },
  settlement_cancelled: { label: "A repayment with you is withdrawn or cancelled", section: "Repayments" },
  group_invitation: { label: "You're invited to a group", section: "Groups" },
  member_joined: { label: "Someone joins a group through your invitation", section: "Groups" },
  member_left: { label: "Someone leaves one of your groups", section: "Groups" },
  member_removed: { label: "You're removed from a group", section: "Groups" },
  friend_request: { label: "Someone sends you a friend request", section: "Friends" },
  friend_accepted: { label: "Someone accepts your friend request", section: "Friends" },
};

/** Saved preferences as a complete map (no row = on, as in `private.notify`). */
export function preferenceMap(
  rows: readonly { type: string; in_app: boolean }[],
): Record<NotificationType, boolean> {
  const map = Object.fromEntries(NOTIFICATION_TYPES.map((type) => [type, true])) as Record<NotificationType, boolean>;
  for (const row of rows) {
    if (isNotificationType(row.type)) map[row.type] = row.in_app;
  }
  return map;
}
