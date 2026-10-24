import "server-only";

import { z } from "zod";

import type { StoredExpense } from "@/lib/expenses/form-values";
import { assertMinorAmount } from "@/lib/money/amount";
import { type Frequency, isFrequency, isRecurringStatus, type RecurringStatus } from "@/lib/recurring/schedule";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth";
import { getGroupNames, getPersonCards, nameOf, type PersonCard } from "@/server/people";

type Client = Awaited<ReturnType<typeof createClient>>;

// The template's jsonb columns, in the shapes create_recurring_expense validated.
const payersSchema = z.array(z.object({ user_id: z.string(), amount: z.number() }));
const sharesSchema = z.array(
  z.object({
    user_id: z.string(),
    amount: z.number(),
    basis_points: z.number().nullish(),
    weight: z.number().nullish(),
    received_rounding_unit: z.boolean().nullish(),
  }),
);
const itemsSchema = z
  .array(
    z.object({
      name: z.string(),
      kind: z.string(),
      amount: z.number(),
      allocation: z.string().nullish(),
      assignments: z.array(z.object({ user_id: z.string() })).nullish(),
    }),
  )
  .nullable();

const STATUS_ORDER: Record<RecurringStatus, number> = { active: 0, paused: 1, ended: 2, cancelled: 3 };

function parsePayload(row: { payers: unknown; shares: unknown; items?: unknown }) {
  const payers = payersSchema.parse(row.payers);
  const shares = sharesSchema.parse(row.shares);
  for (const entry of [...payers, ...shares]) assertMinorAmount(entry.amount, { allowZero: true });
  return { payers, shares, items: itemsSchema.parse(row.items ?? null) ?? [] };
}

function involvedIn(payload: ReturnType<typeof parsePayload>): string[] {
  return [...new Set([...payload.payers.map((p) => p.user_id), ...payload.shares.map((s) => s.user_id)])];
}

function asFrequency(value: string): Frequency {
  if (!isFrequency(value)) throw new Error("Unknown frequency.");
  return value;
}

function asStatus(value: string): RecurringStatus {
  if (!isRecurringStatus(value)) throw new Error("Unknown recurring status.");
  return value;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export interface RecurringListItem {
  id: string;
  description: string;
  amount: number;
  currency: string;
  frequency: Frequency;
  startDate: string;
  nextDate: string | null;
  status: RecurringStatus;
  /** The group's name, or the friend's for a direct template. */
  where: string;
  /** The caller's share of each occurrence, when they take part. */
  myShare: number | null;
}

/** Every template the caller can see (RLS): active first, by next date. */
export async function listRecurring(): Promise<RecurringListItem[]> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recurring_expenses")
    .select("id, group_id, description, amount, currency, frequency, start_date, next_occurrence_date, status, payers, shares")
    .order("next_occurrence_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error("Could not load recurring expenses.");

  const rows = data.map((row) => ({ row, payload: parsePayload(row) }));
  const otherOf = (involved: string[]) => involved.find((id) => id !== user.id) ?? user.id;
  const [groupNames, cards] = await Promise.all([
    getGroupNames(supabase, [...new Set(rows.flatMap(({ row }) => (row.group_id ? [row.group_id] : [])))]),
    getPersonCards(
      supabase,
      rows.flatMap(({ row, payload }) => (row.group_id ? [] : [otherOf(involvedIn(payload))])),
    ),
  ]);

  return rows
    .map(({ row, payload }) => ({
      id: row.id,
      description: row.description,
      amount: row.amount,
      currency: row.currency,
      frequency: asFrequency(row.frequency),
      startDate: row.start_date,
      nextDate: row.next_occurrence_date,
      status: asStatus(row.status),
      where: row.group_id
        ? (groupNames.get(row.group_id) ?? "A group")
        : nameOf(cards, otherOf(involvedIn(payload))),
      myShare: payload.shares.find((share) => share.user_id === user.id)?.amount ?? null,
    }))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}

// ---------------------------------------------------------------------------
// One template
// ---------------------------------------------------------------------------

export interface RecurringOccurrence {
  date: string;
  status: "created" | "skipped" | "failed";
  expenseId: string | null;
  error: string | null;
}

export interface RecurringDetail {
  id: string;
  groupId: string | null;
  groupName: string | null;
  /** The other person of a direct template. */
  friendId: string | null;
  frequency: Frequency;
  startDate: string;
  endDate: string | null;
  timezone: string;
  nextDate: string | null;
  status: RecurringStatus;
  version: number;
  createdBy: string;
  /** The template as an expense, to show its split and fill the edit form. */
  stored: StoredExpense;
  shares: { userId: string; amount: number; roundingUnit: boolean }[];
  occurrences: RecurringOccurrence[];
  /** Mirrors `private.require_recurring_manager`; the database checks again. */
  canManage: boolean;
  lockedReason: string | null;
  people: Map<string, PersonCard>;
}

/** A template the caller can see (RLS), with its latest occurrences, or null. */
export async function getRecurring(recurringId: string): Promise<RecurringDetail | null> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("recurring_expenses")
    .select(
      "id, group_id, created_by, description, amount, currency, category, notes, tags, split_method, frequency, start_date, end_date, next_occurrence_date, timezone, status, version, payers, shares, items",
    )
    .eq("id", recurringId)
    .maybeSingle();
  if (error) throw new Error("Could not load this recurring expense.");
  if (!row) return null;

  const payload = parsePayload(row);
  const involved = involvedIn(payload);
  const [occurrences, groupNames, people, canManage] = await Promise.all([
    supabase
      .from("recurring_occurrences")
      .select("occurrence_date, status, expense_id, error")
      .eq("recurring_expense_id", recurringId)
      .order("occurrence_date", { ascending: false })
      .limit(50),
    getGroupNames(supabase, row.group_id ? [row.group_id] : []),
    getPersonCards(supabase, [user.id, row.created_by, ...involved]),
    managePermission(supabase, user.id, row.group_id, involved),
  ]);
  if (occurrences.error) throw new Error("Could not load this recurring expense.");

  const status = asStatus(row.status);
  const lockedReason =
    status === "cancelled"
      ? "This recurring expense was cancelled."
      : canManage
        ? null
        : row.group_id
          ? "Only current group members can change it."
          : "Only the two friends involved can change it.";

  return {
    id: row.id,
    groupId: row.group_id,
    groupName: row.group_id ? (groupNames.get(row.group_id) ?? "A group") : null,
    friendId: row.group_id ? null : (involved.find((id) => id !== user.id) ?? null),
    frequency: asFrequency(row.frequency),
    startDate: row.start_date,
    endDate: row.end_date,
    timezone: row.timezone,
    nextDate: row.next_occurrence_date,
    status,
    version: row.version,
    createdBy: row.created_by,
    stored: {
      description: row.description,
      amount: row.amount,
      currency: row.currency,
      expenseDate: row.start_date,
      category: row.category,
      notes: row.notes,
      tags: row.tags,
      splitMethod: row.split_method,
      payers: payload.payers.map((payer) => ({ userId: payer.user_id, amount: payer.amount })),
      participants: payload.shares.map((share) => ({
        userId: share.user_id,
        amount: share.amount,
        basisPoints: share.basis_points ?? null,
        weight: share.weight ?? null,
      })),
      items: payload.items.map((item) => ({
        kind: item.kind,
        name: item.name,
        amount: item.amount,
        allocation: item.allocation ?? null,
        assignees: (item.assignments ?? []).map((assignment) => assignment.user_id),
      })),
    },
    shares: payload.shares.map((share) => ({
      userId: share.user_id,
      amount: share.amount,
      roundingUnit: share.received_rounding_unit === true,
    })),
    occurrences: occurrences.data.map((occurrence) => ({
      date: occurrence.occurrence_date,
      status: occurrence.status === "failed" ? "failed" : occurrence.status === "skipped" ? "skipped" : "created",
      expenseId: occurrence.expense_id,
      error: occurrence.error,
    })),
    canManage: canManage && status !== "cancelled",
    lockedReason,
    people,
  };
}

async function managePermission(
  supabase: Client,
  userId: string,
  groupId: string | null,
  involved: readonly string[],
): Promise<boolean> {
  if (!groupId) return involved.includes(userId);
  const { data, error } = await supabase
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .is("left_at", null)
    .maybeSingle();
  if (error) throw new Error("Could not load this recurring expense.");
  return data !== null;
}

/** The template an expense was generated from, if any (to link back to it). */
export async function getExpenseRecurringSource(expenseId: string): Promise<{ id: string; date: string } | null> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recurring_occurrences")
    .select("recurring_expense_id, occurrence_date")
    .eq("expense_id", expenseId)
    .maybeSingle();
  if (error) throw new Error("Could not load this expense.");
  return data ? { id: data.recurring_expense_id, date: data.occurrence_date } : null;
}
