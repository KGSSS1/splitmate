import "server-only";

import {
  describeNotification,
  type NotificationItem,
  notificationPeople,
  type NotificationRow,
} from "@/lib/notifications/describe";
import { type NotificationType, preferenceMap } from "@/lib/notifications/types";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth";
import { getGroupNames, getPersonCards, nameOf } from "@/server/people";

type Client = Awaited<ReturnType<typeof createClient>>;

export const NOTIFICATIONS_PAGE_SIZE = 25;

export interface NotificationPage {
  items: NotificationItem[];
  total: number;
  unread: number;
  pageCount: number;
}

const COLUMNS = "id, type, actor_id, group_id, expense_id, settlement_id, data, read_at, created_at" as const;

/** How many unread notifications the viewer has (RLS: their own only). */
export async function countUnread(supabase: Client): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  if (error) throw new Error("Could not load notifications.");
  return count ?? 0;
}

/**
 * One page of the viewer's notifications, newest first, in words. Takes the
 * client so integration tests can run it as any user.
 */
export async function loadNotifications(supabase: Client, page: number): Promise<NotificationPage> {
  const from = (page - 1) * NOTIFICATIONS_PAGE_SIZE;
  const [{ data, error, count }, unread] = await Promise.all([
    supabase
      .from("notifications")
      .select(COLUMNS, { count: "exact" })
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, from + NOTIFICATIONS_PAGE_SIZE - 1),
    countUnread(supabase),
  ]);
  if (error) throw new Error("Could not load notifications.");
  const rows = data as NotificationRow[];

  const [cards, groupNames] = await Promise.all([
    getPersonCards(supabase, rows.flatMap(notificationPeople)),
    getGroupNames(supabase, rows.flatMap((row) => (row.group_id ? [row.group_id] : []))),
  ]);
  const context = {
    nameOf: (id: string) => nameOf(cards, id),
    groupName: (id: string) => groupNames.get(id) ?? null,
  };
  const total = count ?? 0;
  return {
    items: rows.flatMap((row) => describeNotification(row, context) ?? []),
    total,
    unread,
    pageCount: Math.max(1, Math.ceil(total / NOTIFICATIONS_PAGE_SIZE)),
  };
}

export async function listNotifications(page = 1): Promise<NotificationPage> {
  await requireUser();
  return loadNotifications(await createClient(), page);
}

export async function getUnreadCount(): Promise<number> {
  await requireUser();
  return countUnread(await createClient());
}

/** In-app setting for every type (no saved row = on). */
export async function getNotificationPreferences(): Promise<Record<NotificationType, boolean>> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("notification_preferences").select("type, in_app");
  if (error) throw new Error("Could not load your notification settings.");
  return preferenceMap(data);
}
