import "server-only";

import { type AuditEventRow, describeActivity, type ActivityItem } from "@/lib/activity/describe";
import type { SettlementStatus } from "@/lib/accounting/types";
import { assertMinorAmount } from "@/lib/money/amount";
import { contextKey } from "@/lib/settlements/friend-view";
import { availableSettlementActions, type SettlementAction } from "@/lib/settlements/lifecycle";
import { isSettlementStatus, SETTLEMENTS_PAGE_SIZE } from "@/lib/settlements/options";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation/groups";
import { requireUser } from "@/server/auth";
import { getGroupNames, getPersonCards, nameOf } from "@/server/people";

type Client = Awaited<ReturnType<typeof createClient>>;

export interface SettlementItem {
  id: string;
  groupId: string | null;
  groupName: string | null;
  payerId: string;
  payerName: string;
  receiverId: string;
  receiverName: string;
  amount: number;
  currency: string;
  method: string;
  upiReference: string | null;
  note: string | null;
  settledOn: string;
  status: SettlementStatus;
  createdBy: string;
  createdAt: string;
  /** What the viewer may do now (the database re-checks every action). */
  actions: SettlementAction[];
}

export interface SettlementPage {
  items: SettlementItem[];
  total: number;
  pageCount: number;
}

const SETTLEMENT_COLUMNS =
  "id, group_id, payer_id, receiver_id, amount, currency, method, upi_reference, note, settled_on, status, created_by, created_at" as const;

interface SettlementRow {
  id: string;
  group_id: string | null;
  payer_id: string;
  receiver_id: string;
  amount: number;
  currency: string;
  method: string;
  upi_reference: string | null;
  note: string | null;
  settled_on: string;
  status: string;
  created_by: string;
  created_at: string;
}

/** Groups the viewer is currently in: former members cannot act on a group's settlements. */
async function currentGroupIds(supabase: Client, userId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId)
    .is("left_at", null);
  if (error) throw new Error("Could not load your groups.");
  return new Set(data.map((row) => row.group_id));
}

async function toItems(supabase: Client, viewerId: string, rows: readonly SettlementRow[]): Promise<SettlementItem[]> {
  if (rows.length === 0) return [];
  const [cards, groups, groupNames] = await Promise.all([
    getPersonCards(
      supabase,
      rows.flatMap((row) => [row.payer_id, row.receiver_id]),
    ),
    currentGroupIds(supabase, viewerId),
    getGroupNames(
      supabase,
      rows.flatMap((row) => (row.group_id ? [row.group_id] : [])),
    ),
  ]);
  return rows.map((row) => {
    assertMinorAmount(row.amount, {}, "settlement amount");
    const status: SettlementStatus = isSettlementStatus(row.status) ? row.status : "cancelled";
    const canAct = row.group_id === null || groups.has(row.group_id);
    return {
      id: row.id,
      groupId: row.group_id,
      groupName: row.group_id ? (groupNames.get(row.group_id) ?? "A group") : null,
      payerId: row.payer_id,
      payerName: nameOf(cards, row.payer_id),
      receiverId: row.receiver_id,
      receiverName: nameOf(cards, row.receiver_id),
      amount: row.amount,
      currency: row.currency,
      method: row.method,
      upiReference: row.upi_reference,
      note: row.note,
      settledOn: row.settled_on,
      status,
      createdBy: row.created_by,
      createdAt: row.created_at,
      actions: canAct
        ? availableSettlementActions({ payerId: row.payer_id, receiverId: row.receiver_id, status }, viewerId)
        : [],
    };
  });
}

export type SettlementScope =
  | { kind: "mine" }
  | { kind: "group"; groupId: string }
  | { kind: "friend"; friendId: string };

/**
 * Settlements newest first, `SETTLEMENTS_PAGE_SIZE` per page. RLS decides what
 * is visible: the payer and receiver always, plus current members of the group.
 */
export async function listSettlements(scope: SettlementScope, page = 1): Promise<SettlementPage> {
  const user = await requireUser();
  const supabase = await createClient();
  const from = (page - 1) * SETTLEMENTS_PAGE_SIZE;

  let query = supabase.from("settlements").select(SETTLEMENT_COLUMNS, { count: "exact" });
  if (scope.kind === "group") query = query.eq("group_id", scope.groupId);
  if (scope.kind === "mine") query = query.or(`payer_id.eq.${user.id},receiver_id.eq.${user.id}`);
  if (scope.kind === "friend") {
    // The ID goes into a filter string: never anything but a UUID.
    uuidSchema.parse(scope.friendId);
    query = query.or(
      `and(payer_id.eq.${user.id},receiver_id.eq.${scope.friendId}),and(payer_id.eq.${scope.friendId},receiver_id.eq.${user.id})`,
    );
  }
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .order("id")
    .range(from, from + SETTLEMENTS_PAGE_SIZE - 1);
  if (error) throw new Error("Could not load settlements.");

  const total = count ?? data.length;
  return {
    items: await toItems(supabase, user.id, data),
    total,
    pageCount: Math.max(1, Math.ceil(total / SETTLEMENTS_PAGE_SIZE)),
  };
}

/** Pending settlements the viewer is part of: ones to confirm (as receiver) and ones waiting on someone else. */
export async function listPendingSettlements(): Promise<{ toConfirm: SettlementItem[]; waiting: SettlementItem[] }> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("settlements")
    .select(SETTLEMENT_COLUMNS)
    .eq("status", "pending")
    .or(`payer_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error("Could not load settlements.");
  const items = await toItems(supabase, user.id, data);
  return {
    toConfirm: items.filter((item) => item.receiverId === user.id),
    waiting: items.filter((item) => item.payerId === user.id),
  };
}

/**
 * Contexts (`contextKey`) where a payment between the viewer and `friendId` is
 * still waiting for confirmation; "settle up everything" leaves them out (SPEC §11).
 */
export async function pendingContextKeysWith(friendId: string): Promise<Set<string>> {
  const user = await requireUser();
  uuidSchema.parse(friendId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("settlements")
    .select("group_id, currency")
    .eq("status", "pending")
    .or(
      `and(payer_id.eq.${user.id},receiver_id.eq.${friendId}),and(payer_id.eq.${friendId},receiver_id.eq.${user.id})`,
    );
  if (error) throw new Error("Could not load settlements.");
  return new Set(data.map((row) => contextKey(row.group_id, row.currency)));
}

export interface SettlementDetail extends SettlementItem {
  history: ActivityItem[];
}

/** A settlement the viewer can see (RLS), with its history, or null. */
export async function getSettlement(settlementId: string): Promise<SettlementDetail | null> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("settlements")
    .select(SETTLEMENT_COLUMNS)
    .eq("id", settlementId)
    .maybeSingle();
  if (error) throw new Error("Could not load this settlement.");
  if (!data) return null;

  const { data: events, error: eventsError } = await supabase
    .from("audit_events")
    .select("id, actor_id, action, entity_type, entity_id, group_id, before, after, created_at")
    .eq("entity_type", "settlement")
    .eq("entity_id", settlementId)
    .order("created_at")
    .order("id");
  if (eventsError) throw new Error("Could not load this settlement.");

  const [item] = await toItems(supabase, user.id, [data]);
  if (!item) return null;
  const cards = await getPersonCards(
    supabase,
    events.flatMap((event) => (event.actor_id ? [event.actor_id] : [])),
  );
  const names = new Map([
    [item.payerId, item.payerName],
    [item.receiverId, item.receiverName],
  ]);
  const name = (id: string) => names.get(id) ?? nameOf(cards, id);
  return {
    ...item,
    history: (events as AuditEventRow[]).flatMap((event) => describeActivity(event, user.id, name) ?? []),
  };
}
