"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";
import {
  createGroupSchema,
  groupIdSchema,
  memberActionSchema,
  setMemberRoleSchema,
  updateGroupSchema,
} from "@/lib/validation/groups";
import { type ActionResult, invalidInput, rpcFailure } from "@/server/action-result";
import { requireOnboardedProfile } from "@/server/auth";

export async function createGroup(input: unknown): Promise<ActionResult> {
  const parsed = createGroupSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  await requireOnboardedProfile();
  const supabase = await createClient();
  const { data: groupId, error } = await supabase.rpc("create_group", {
    p_name: parsed.data.name,
    p_description: parsed.data.description,
    p_default_currency: parsed.data.defaultCurrency,
    p_group_type: parsed.data.groupType,
    p_simplify_debts: parsed.data.simplifyDebts,
  });
  if (error) return rpcFailure(error);

  redirect(`${ROUTES.groups}/${groupId}`);
}

/** Admins only; the database function checks the role. */
export async function updateGroup(input: unknown): Promise<ActionResult> {
  const parsed = updateGroupSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  await requireOnboardedProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_group", {
    p_group_id: parsed.data.groupId,
    p_name: parsed.data.name,
    p_description: parsed.data.description,
    p_default_currency: parsed.data.defaultCurrency,
    p_group_type: parsed.data.groupType,
    p_simplify_debts: parsed.data.simplifyDebts,
  });
  if (error) return rpcFailure(error);

  refresh();
  return { ok: true, message: "Group settings saved." };
}

/** Allowed only when the caller's balance in the group is zero in every currency (SPEC §2). */
export async function leaveGroup(input: unknown): Promise<ActionResult> {
  const parsed = groupIdSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  await requireOnboardedProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("leave_group", { p_group_id: parsed.data.groupId });
  if (error) return rpcFailure(error);

  redirect(`${ROUTES.groups}?left=1`);
}

/** Admins remove a member whose balance in the group is zero in every currency. */
export async function removeMember(input: unknown): Promise<ActionResult> {
  const parsed = memberActionSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  await requireOnboardedProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_group_member", {
    p_group_id: parsed.data.groupId,
    p_user_id: parsed.data.userId,
  });
  if (error) return rpcFailure(error);

  refresh();
  return { ok: true, message: "Member removed." };
}

export async function setMemberRole(input: unknown): Promise<ActionResult> {
  const parsed = setMemberRoleSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  await requireOnboardedProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_member_role", {
    p_group_id: parsed.data.groupId,
    p_user_id: parsed.data.userId,
    p_role: parsed.data.role,
  });
  if (error) return rpcFailure(error);

  refresh();
  return { ok: true, message: parsed.data.role === "admin" ? "Made an admin." : "Admin role removed." };
}
