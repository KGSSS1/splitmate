import "server-only";

import { assertMinorAmount } from "@/lib/money/amount";
import type { StoredExpense } from "@/lib/expenses/form-values";
import { describeChanges, type FieldChange, parseSnapshot, snapshotUsers } from "@/lib/expenses/history";
import { EXPENSES_PAGE_SIZE } from "@/lib/expenses/options";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth";
import { getPersonCards, nameOf, type PersonCard } from "@/server/people";

type Client = Awaited<ReturnType<typeof createClient>>;

// ---------------------------------------------------------------------------
// Form options: where an expense can go and who can take part
// ---------------------------------------------------------------------------

export interface ExpensePerson {
  id: string;
  name: string;
}

export interface ExpenseFormOptions {
  me: ExpensePerson;
  groups: { id: string; name: string; defaultCurrency: string; members: ExpensePerson[] }[];
  friends: ExpensePerson[];
}

/** The caller's current groups (with current members in join order) and accepted friends. */
export async function getExpenseFormOptions(): Promise<ExpenseFormOptions> {
  const user = await requireUser();
  const supabase = await createClient();

  const [mine, friendships] = await Promise.all([
    supabase
      .from("group_members")
      .select("groups!group_members_group_id_fkey(id, name, default_currency)")
      .eq("user_id", user.id)
      .is("left_at", null),
    supabase.from("friendships").select("user_low, user_high").eq("status", "accepted"),
  ]);
  if (mine.error || friendships.error) throw new Error("Could not load your groups and friends.");

  const groups = mine.data.flatMap((row) => (row.groups ? [row.groups] : []));
  const members = groups.length
    ? await supabase
        .from("group_members")
        .select("group_id, user_id, joined_at")
        .in(
          "group_id",
          groups.map((group) => group.id),
        )
        .is("left_at", null)
        .order("joined_at")
        .order("user_id")
    : { data: [], error: null };
  if (members.error) throw new Error("Could not load group members.");

  const friendIds = friendships.data.map((row) => (row.user_low === user.id ? row.user_high : row.user_low));
  const cards = await getPersonCards(supabase, [user.id, ...friendIds, ...members.data.map((row) => row.user_id)]);
  const person = (id: string): ExpensePerson => ({ id, name: nameOf(cards, id) });

  return {
    me: person(user.id),
    groups: groups
      .map((group) => ({
        id: group.id,
        name: group.name,
        defaultCurrency: group.default_currency,
        members: members.data.filter((row) => row.group_id === group.id).map((row) => person(row.user_id)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    friends: friendIds.map(person).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// ---------------------------------------------------------------------------
// One expense
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  id: string;
  action: "created" | "updated" | "cancelled";
  actorName: string;
  at: string;
  changes: FieldChange[];
}

export interface ExpenseComment {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface ExpenseDetail extends StoredExpense {
  id: string;
  groupId: string | null;
  groupName: string | null;
  status: "active" | "cancelled";
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Who can see it is decided by RLS; whether the caller can still change it is worked out here. */
  canChange: boolean;
  /** Comments need the same membership or friendship, but not an active, unfrozen expense. */
  canComment: boolean;
  /** Why it can't be changed, when it can't. */
  lockedReason: string | null;
  /** Shares with the rounding unit marked (SPEC §7). */
  shares: { userId: string; amount: number; roundingUnit: boolean }[];
  /** The other person of a direct expense. */
  friendId: string | null;
  people: Map<string, PersonCard>;
  history: HistoryEntry[];
  comments: ExpenseComment[];
}

const EXPENSE_COLUMNS =
  "id, group_id, description, amount, currency, expense_date, category, notes, tags, split_method, status, version, created_at, updated_at" as const;

/** An expense the caller can see (RLS), at its current version, or null. */
export async function getExpense(expenseId: string): Promise<ExpenseDetail | null> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: expense, error } = await supabase
    .from("expenses")
    .select(EXPENSE_COLUMNS)
    .eq("id", expenseId)
    .maybeSingle();
  if (error) throw new Error("Could not load this expense.");
  if (!expense) return null;
  const version = expense.version;

  const [payers, participants, items, history, comments, group] = await Promise.all([
    supabase.from("expense_payers").select("user_id, amount").eq("expense_id", expenseId).eq("version", version),
    supabase
      .from("expense_participants")
      .select("user_id, amount, basis_points, weight, received_rounding_unit, created_at")
      .eq("expense_id", expenseId)
      .eq("version", version)
      .order("created_at")
      .order("id"),
    supabase
      .from("expense_items")
      .select("kind, name, amount, allocation, position, expense_item_assignments(user_id)")
      .eq("expense_id", expenseId)
      .eq("version", version)
      .order("position"),
    supabase
      .from("audit_events")
      .select("id, action, actor_id, before, after, created_at")
      .eq("entity_type", "expense")
      .eq("entity_id", expenseId)
      .order("created_at"),
    supabase
      .from("comments")
      .select("id, author_id, body, created_at")
      .eq("expense_id", expenseId)
      .is("deleted_at", null)
      .order("created_at")
      .limit(200),
    expense.group_id
      ? supabase.from("groups").select("name").eq("id", expense.group_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (payers.error || participants.error || items.error || history.error || comments.error || group.error) {
    throw new Error("Could not load this expense.");
  }

  const snapshots = history.data.map((row) => ({ row, before: parseSnapshot(row.before), after: parseSnapshot(row.after) }));
  const involved = [...new Set([...payers.data.map((p) => p.user_id), ...participants.data.map((p) => p.user_id)])];
  const people = await getPersonCards(supabase, [
    user.id,
    ...involved,
    ...history.data.flatMap((row) => (row.actor_id ? [row.actor_id] : [])),
    ...snapshots.flatMap(({ before, after }) => [...snapshotUsers(before), ...snapshotUsers(after)]),
    ...comments.data.map((row) => row.author_id),
  ]);
  const name = (id: string) => nameOf(people, id);

  for (const row of [...payers.data, ...participants.data]) {
    assertMinorAmount(row.amount, { allowZero: true });
  }

  const { canChange, canComment, lockedReason } = await changePermission(supabase, user.id, expense, involved);

  return {
    id: expense.id,
    groupId: expense.group_id,
    groupName: group.data?.name ?? null,
    status: expense.status === "cancelled" ? "cancelled" : "active",
    version,
    createdAt: expense.created_at,
    updatedAt: expense.updated_at,
    description: expense.description,
    amount: expense.amount,
    currency: expense.currency,
    expenseDate: expense.expense_date,
    category: expense.category,
    notes: expense.notes,
    tags: expense.tags,
    splitMethod: expense.split_method,
    payers: payers.data.map((row) => ({ userId: row.user_id, amount: row.amount })),
    participants: participants.data.map((row) => ({
      userId: row.user_id,
      amount: row.amount,
      basisPoints: row.basis_points,
      weight: row.weight,
    })),
    shares: participants.data.map((row) => ({
      userId: row.user_id,
      amount: row.amount,
      roundingUnit: row.received_rounding_unit,
    })),
    items: items.data.map((row) => ({
      kind: row.kind,
      name: row.name,
      amount: row.amount,
      allocation: row.allocation,
      assignees: row.expense_item_assignments.map((assignment) => assignment.user_id),
    })),
    friendId: expense.group_id ? null : (involved.find((id) => id !== user.id) ?? null),
    canChange,
    canComment,
    lockedReason,
    people,
    history: snapshots.map(({ row, before, after }) => ({
      id: row.id,
      action: row.action === "expense.created" ? "created" : row.action === "expense.cancelled" ? "cancelled" : "updated",
      actorName: row.actor_id ? name(row.actor_id) : "Someone",
      at: row.created_at,
      changes: row.action === "expense.updated" && before && after ? describeChanges(before, after, name) : [],
    })),
    comments: comments.data.map((row) => ({
      id: row.id,
      authorId: row.author_id,
      authorName: name(row.author_id),
      body: row.body,
      createdAt: row.created_at,
    })),
  };
}

/**
 * Mirrors `private.lock_expense_for_change` (edit, cancel) and
 * `private.can_edit_expense` (comments) so the page only offers actions the
 * database will accept. The database checks them again anyway.
 */
async function changePermission(
  supabase: Client,
  userId: string,
  expense: { status: string; group_id: string | null },
  involved: readonly string[],
): Promise<{ canChange: boolean; canComment: boolean; lockedReason: string | null }> {
  const denied = (lockedReason: string, canComment = false) => ({ canChange: false, canComment, lockedReason });

  if (!expense.group_id) {
    const other = involved.find((id) => id !== userId);
    if (!other || !involved.includes(userId)) return denied("Only the two friends involved can change it.");
    const { data } = await supabase
      .from("friendships")
      .select("id")
      .eq("user_low", userId < other ? userId : other)
      .eq("user_high", userId < other ? other : userId)
      .eq("status", "accepted")
      .maybeSingle();
    if (!data) return denied("You're no longer friends.");
    if (expense.status !== "active") return denied("This expense was cancelled.", true);
    return { canChange: true, canComment: true, lockedReason: null };
  }

  // RLS shows the full member list only to current members.
  const { data, error } = await supabase
    .from("group_members")
    .select("user_id")
    .eq("group_id", expense.group_id)
    .is("left_at", null);
  if (error) throw new Error("Could not load this expense.");
  const current = new Set(data.map((row) => row.user_id));
  if (!current.has(userId)) return denied("Only current group members can change it.");
  if (expense.status !== "active") return denied("This expense was cancelled.", true);
  if (involved.some((id) => !current.has(id))) {
    return denied("Someone in this expense has left the group, so it can no longer be changed.", true);
  }
  return { canChange: true, canComment: true, lockedReason: null };
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export interface ExpenseListItem {
  id: string;
  description: string;
  amount: number;
  currency: string;
  expenseDate: string;
  category: string | null;
  status: "active" | "cancelled";
  paidBy: string;
  /** The caller's net on this expense: paid − share. Null when not involved. */
  myNet: number | null;
}

export interface ExpensePage {
  items: ExpenseListItem[];
  page: number;
  pageCount: number;
  total: number;
}

async function toListItems(
  supabase: Client,
  userId: string,
  rows: { id: string; description: string; amount: number; currency: string; expense_date: string; category: string | null; status: string; version: number }[],
): Promise<ExpenseListItem[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [payers, participants] = await Promise.all([
    supabase.from("expense_payers").select("expense_id, version, user_id, amount").in("expense_id", ids),
    supabase.from("expense_participants").select("expense_id, version, user_id, amount").in("expense_id", ids),
  ]);
  if (payers.error || participants.error) throw new Error("Could not load expenses.");

  const version = new Map(rows.map((row) => [row.id, row.version]));
  const current = <T extends { expense_id: string; version: number }>(list: T[]) =>
    list.filter((row) => version.get(row.expense_id) === row.version);
  const currentPayers = current(payers.data);
  const currentParticipants = current(participants.data);
  const cards = await getPersonCards(supabase, currentPayers.map((row) => row.user_id));

  return rows.map((row) => {
    const paid = currentPayers.filter((p) => p.expense_id === row.id);
    const shares = currentParticipants.filter((p) => p.expense_id === row.id);
    const myPaid = paid.find((p) => p.user_id === userId)?.amount;
    const myShare = shares.find((p) => p.user_id === userId)?.amount;
    const involved = myPaid !== undefined || myShare !== undefined;
    return {
      id: row.id,
      description: row.description,
      amount: row.amount,
      currency: row.currency,
      expenseDate: row.expense_date,
      category: row.category,
      status: row.status === "cancelled" ? "cancelled" : "active",
      paidBy:
        paid.length === 1 && paid[0]
          ? paid[0].user_id === userId
            ? "You"
            : nameOf(cards, paid[0].user_id)
          : `${paid.length} people`,
      myNet: involved ? (myPaid ?? 0) - (myShare ?? 0) : null,
    };
  });
}

const LIST_COLUMNS = "id, description, amount, currency, expense_date, category, status, version" as const;

/** A group's expenses, newest first, one page at a time (cancelled ones included and labelled). */
export async function listGroupExpenses(groupId: string, page: number): Promise<ExpensePage> {
  const user = await requireUser();
  const supabase = await createClient();
  const from = (page - 1) * EXPENSES_PAGE_SIZE;
  const { data, error, count } = await supabase
    .from("expenses")
    .select(LIST_COLUMNS, { count: "exact" })
    .eq("group_id", groupId)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id")
    .range(from, from + EXPENSES_PAGE_SIZE - 1);
  if (error) throw new Error("Could not load expenses.");
  const total = count ?? 0;
  return {
    items: await toListItems(supabase, user.id, data),
    page,
    pageCount: Math.max(1, Math.ceil(total / EXPENSES_PAGE_SIZE)),
    total,
  };
}

/** Direct (non-group) expenses between the caller and one friend, newest first (the latest 50). */
export async function listDirectExpenses(friendId: string): Promise<ExpenseListItem[]> {
  const user = await requireUser();
  const supabase = await createClient();
  // RLS limits direct expenses to the ones the caller took part in; each has exactly two people.
  const { data, error } = await supabase
    .from("expenses")
    .select(LIST_COLUMNS)
    .is("group_id", null)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false })
    // Kept small: the IDs go into the query string of the next two requests.
    .limit(100);
  if (error) throw new Error("Could not load expenses.");
  if (data.length === 0) return [];

  const { data: parties, error: partiesError } = await supabase
    .from("expense_participants")
    .select("expense_id")
    .eq("user_id", friendId)
    .in(
      "expense_id",
      data.map((row) => row.id),
    );
  const { data: payers, error: payersError } = await supabase
    .from("expense_payers")
    .select("expense_id")
    .eq("user_id", friendId)
    .in(
      "expense_id",
      data.map((row) => row.id),
    );
  if (partiesError || payersError) throw new Error("Could not load expenses.");
  const withFriend = new Set([...parties, ...payers].map((row) => row.expense_id));
  return toListItems(
    supabase,
    user.id,
    data.filter((row) => withFriend.has(row.id)).slice(0, 50),
  );
}
