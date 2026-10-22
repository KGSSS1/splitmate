import "server-only";

import { balancesByPerson } from "@/lib/accounting/person-balances";
import type { CounterpartyBalance } from "@/lib/accounting/summary";
import { type GroupType, toGroupType } from "@/lib/groups/options";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth";
import { getPersonCards, nameOf } from "@/server/people";

type Client = Awaited<ReturnType<typeof createClient>>;

export interface GroupSettings {
  id: string;
  name: string;
  description: string | null;
  groupType: GroupType;
  defaultCurrency: string;
  simplifyDebts: boolean;
}

export interface GroupListItem extends GroupSettings {
  memberCount: number;
  /** The caller's net in this group per currency; empty = settled up. */
  myBalances: CounterpartyBalance[];
}

export interface GroupMember {
  userId: string;
  displayName: string;
  role: "admin" | "member";
  joinedAt: string;
  /** Net per currency in this group, from the ledger; positive = others owe them. */
  balances: CounterpartyBalance[];
}

export interface OpenInvitation {
  id: string;
  createdBy: string;
  createdByName: string;
  invitedEmail: string | null;
  maxUses: number;
  useCount: number;
  expiresAt: string;
  createdAt: string;
}

export type GroupView =
  | { access: "member"; group: GroupSettings; isAdmin: boolean; members: GroupMember[]; invitations: OpenInvitation[] }
  | { access: "former"; group: GroupSettings };

const GROUP_COLUMNS = "id, name, description, group_type, default_currency, simplify_debts" as const;

function toSettings(row: {
  id: string;
  name: string;
  description: string | null;
  group_type: string;
  default_currency: string;
  simplify_debts: boolean;
}): GroupSettings {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    groupType: toGroupType(row.group_type),
    defaultCurrency: row.default_currency,
    simplifyDebts: row.simplify_debts,
  };
}

/** Each member's net per currency in one group (`group_balances`, computed from the ledger). */
async function getGroupBalances(supabase: Client, groupId: string) {
  const { data, error } = await supabase.rpc("group_balances", { p_group_id: groupId });
  if (error) throw new Error("Could not load group balances.");
  return balancesByPerson(data.map((row) => ({ personId: row.user_id, currency: row.currency, amount: row.amount })));
}

/** Groups the caller is currently a member of, by name. */
export async function listMyGroups(): Promise<GroupListItem[]> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: memberships, error } = await supabase
    .from("group_members")
    .select(`groups!group_members_group_id_fkey(${GROUP_COLUMNS})`)
    .eq("user_id", user.id)
    .is("left_at", null);
  if (error) throw new Error("Could not load your groups.");
  const groups = memberships.flatMap((row) => (row.groups ? [toSettings(row.groups)] : []));
  if (groups.length === 0) return [];

  const { data: members, error: membersError } = await supabase
    .from("group_members")
    .select("group_id")
    .in(
      "group_id",
      groups.map((group) => group.id),
    )
    .is("left_at", null);
  if (membersError) throw new Error("Could not load your groups.");
  const counts = new Map<string, number>();
  for (const { group_id } of members) counts.set(group_id, (counts.get(group_id) ?? 0) + 1);

  // The caller's net in every group, in one call (rows for groups they've left are ignored below).
  const { data: mine, error: balancesError } = await supabase.rpc("my_group_balances");
  if (balancesError) throw new Error("Could not load your groups.");
  const balances = balancesByPerson(
    mine.map((row) => ({ personId: row.group_id, currency: row.currency, amount: row.amount })),
  );

  return groups
    .map((group) => ({
      ...group,
      memberCount: counts.get(group.id) ?? 0,
      myBalances: balances.get(group.id) ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A group as the caller may see it: everything for current members, only the
 * settings for former members (SPEC §6: they keep read access to their history),
 * or null when the caller was never a member (RLS hides the group).
 */
export async function getGroup(groupId: string): Promise<GroupView | null> {
  const user = await requireUser();
  const supabase = await createClient();

  const [groupResult, membershipResult] = await Promise.all([
    supabase.from("groups").select(GROUP_COLUMNS).eq("id", groupId).maybeSingle(),
    supabase.from("group_members").select("role, left_at").eq("group_id", groupId).eq("user_id", user.id).maybeSingle(),
  ]);
  if (groupResult.error || membershipResult.error) throw new Error("Could not load this group.");
  if (!groupResult.data || !membershipResult.data) return null;

  const group = toSettings(groupResult.data);
  if (membershipResult.data.left_at) return { access: "former", group };

  const now = new Date().toISOString();
  const [membersResult, invitationsResult, balances] = await Promise.all([
    supabase
      .from("group_members")
      .select("user_id, role, joined_at")
      .eq("group_id", groupId)
      .is("left_at", null)
      .order("joined_at"),
    supabase
      .from("group_invitations")
      .select("id, created_by, invited_email, max_uses, use_count, expires_at, created_at")
      .eq("group_id", groupId)
      .is("revoked_at", null)
      .gt("expires_at", now)
      .order("created_at", { ascending: false })
      .limit(50),
    getGroupBalances(supabase, groupId),
  ]);
  if (membersResult.error || invitationsResult.error) throw new Error("Could not load this group.");

  const invitations = invitationsResult.data.filter((row) => row.use_count < row.max_uses);
  const cards = await getPersonCards(supabase, [
    ...membersResult.data.map((row) => row.user_id),
    ...invitations.map((row) => row.created_by),
  ]);

  return {
    access: "member",
    group,
    isAdmin: membershipResult.data.role === "admin",
    members: membersResult.data.map((row) => ({
      userId: row.user_id,
      displayName: nameOf(cards, row.user_id),
      role: row.role === "admin" ? "admin" : "member",
      joinedAt: row.joined_at,
      balances: balances.get(row.user_id) ?? [],
    })),
    invitations: invitations.map((row) => ({
      id: row.id,
      createdBy: row.created_by,
      createdByName: nameOf(cards, row.created_by),
      invitedEmail: row.invited_email,
      maxUses: row.max_uses,
      useCount: row.use_count,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    })),
  };
}

export interface PendingInvitation {
  invitationId: string;
  groupId: string;
  groupName: string;
  groupType: GroupType;
  inviterName: string;
  expiresAt: string;
}

/** Open invitations addressed to the caller's email address. */
export async function listMyInvitations(): Promise<PendingInvitation[]> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_group_invitations");
  if (error) throw new Error("Could not load your invitations.");
  return data.map((row) => ({
    invitationId: row.invitation_id,
    groupId: row.group_id,
    groupName: row.group_name,
    groupType: toGroupType(row.group_type),
    inviterName: row.inviter_name,
    expiresAt: row.expires_at,
  }));
}
