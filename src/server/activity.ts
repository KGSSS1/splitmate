import "server-only";

import {
  type ActivityItem,
  activityPeople,
  type AuditEventRow,
  describeActivity,
} from "@/lib/activity/describe";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth";
import { getPersonCards, nameOf } from "@/server/people";

export const ACTIVITY_PAGE_SIZE = 25;

export interface ActivityFeedItem extends ActivityItem {
  groupName: string | null;
}

export interface ActivityPage {
  items: ActivityFeedItem[];
  total: number;
  pageCount: number;
}

/**
 * Expense and settlement history the viewer can see, newest first.
 * `my_activity` starts from the viewer's own groups, settlements and expenses
 * (so its cost follows their activity, not everyone's) and RLS on
 * `audit_events` still decides visibility.
 */
export async function listActivity({ page = 1, limit = ACTIVITY_PAGE_SIZE }: { page?: number; limit?: number } = {}) {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("my_activity", { p_limit: limit, p_offset: (page - 1) * limit });
  if (error) throw new Error("Could not load activity.");
  const rows = data as AuditEventRow[];

  const groupIds = [...new Set(rows.flatMap((row) => (row.group_id ? [row.group_id] : [])))];
  const [cards, groups] = await Promise.all([
    getPersonCards(supabase, rows.flatMap(activityPeople)),
    groupIds.length
      ? supabase.from("groups").select("id, name").in("id", groupIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (groups.error) throw new Error("Could not load activity.");
  const groupNames = new Map(groups.data.map((group) => [group.id, group.name]));

  const total = data[0]?.total_count ?? 0;
  return {
    items: rows.flatMap((row) => {
      const item = describeActivity(row, user.id, (id) => nameOf(cards, id));
      return item ? [{ ...item, groupName: item.groupId ? (groupNames.get(item.groupId) ?? null) : null }] : [];
    }),
    total,
    pageCount: Math.max(1, Math.ceil(total / limit)),
  } satisfies ActivityPage;
}
