import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FormStatus } from "@/components/forms/form-status";
import { GroupHeader } from "@/components/groups/group-header";
import { InvitePanel } from "@/components/groups/invite-panel";
import { ActionButton } from "@/components/shared/action-button";
import { BalanceText } from "@/components/shared/balance-text";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isSettledUp } from "@/lib/accounting/person-balances";
import { uuidSchema } from "@/lib/validation/groups";
import { leaveGroup, removeMember, setMemberRole } from "@/server/actions/groups";
import { revokeInvitation } from "@/server/actions/invitations";
import { requireOnboardedProfile } from "@/server/auth";
import { getGroup, type GroupMember, type OpenInvitation } from "@/server/groups";

export const metadata: Metadata = { title: "Group members" };

const dateFormat = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });

export default async function GroupMembersPage({ params }: PageProps<"/groups/[groupId]/members">) {
  const [{ groupId }, profile] = await Promise.all([params, requireOnboardedProfile()]);
  if (!uuidSchema.safeParse(groupId).success) notFound();
  const view = await getGroup(groupId);
  if (!view) notFound();

  if (view.access === "former") {
    return (
      <div className="grid max-w-3xl gap-6">
        <GroupHeader group={view.group} showTabs={false} />
        <FormStatus error="You're no longer a member of this group. Ask a member for a new invitation to rejoin." />
      </div>
    );
  }

  const { group, isAdmin, members, invitations } = view;
  const me = members.find((member) => member.userId === profile.id);
  const canLeave = isSettledUp(me?.balances);

  return (
    <div className="grid max-w-3xl gap-6">
      <GroupHeader group={group} />

      <section aria-labelledby="members-heading" className="grid gap-3">
        <h2 id="members-heading" className="text-lg font-semibold">
          Members ({members.length})
        </h2>
        <ul className="divide-y rounded-xl border" aria-label="Members">
          {members.map((member) => (
            <MemberRow
              key={member.userId}
              member={member}
              groupId={group.id}
              isMe={member.userId === profile.id}
              viewerIsAdmin={isAdmin}
            />
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Balances come from this group&apos;s expenses and repayments, per currency.
        </p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Invite people</h2>
          </CardTitle>
          <CardDescription>
            Everyone who joins becomes friends with the group&apos;s members, so you can also split expenses directly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InvitePanel groupId={group.id} />
        </CardContent>
      </Card>

      {invitations.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Open invitations</h2>
            </CardTitle>
            <CardDescription>Revoke an invitation to stop it from being used.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-4" aria-label="Open invitations">
              {invitations.map((invitation) => (
                <InvitationRow
                  key={invitation.id}
                  invitation={invitation}
                  canRevoke={isAdmin || invitation.createdBy === profile.id}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Leave group</h2>
          </CardTitle>
          <CardDescription>
            {canLeave
              ? "You'll keep read access to your past expenses in this group."
              : "You can leave once your balance in this group is settled in every currency."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canLeave ? (
            <ActionButton
              variant="destructive"
              confirm={`Leave ${group.name}? You'll need a new invitation to rejoin.`}
              confirmLabel="Leave group"
              action={leaveGroup.bind(null, { groupId: group.id })}
            >
              Leave group
            </ActionButton>
          ) : (
            <BalanceText balances={me?.balances ?? []} perspective="self" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MemberRow({
  member,
  groupId,
  isMe,
  viewerIsAdmin,
}: {
  member: GroupMember;
  groupId: string;
  isMe: boolean;
  viewerIsAdmin: boolean;
}) {
  const settled = isSettledUp(member.balances);
  return (
    <li className="grid gap-3 px-4 py-3 sm:flex sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium">
          {member.displayName}
          {isMe ? <span className="text-muted-foreground"> (you)</span> : null}
          {member.role === "admin" ? (
            <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Admin</span>
          ) : null}
        </p>
        <BalanceText balances={member.balances} perspective={isMe ? "self" : "member"} />
      </div>
      {viewerIsAdmin && !isMe ? (
        <div className="flex flex-wrap gap-2">
          <ActionButton
            variant="ghost"
            action={setMemberRole.bind(null, {
              groupId,
              userId: member.userId,
              role: member.role === "admin" ? "member" : "admin",
            })}
          >
            {member.role === "admin" ? "Remove admin" : "Make admin"}
          </ActionButton>
          {settled ? (
            <ActionButton
              variant="destructive"
              confirm={`Remove ${member.displayName} from the group?`}
              confirmLabel="Remove"
              action={removeMember.bind(null, { groupId, userId: member.userId })}
            >
              Remove
            </ActionButton>
          ) : (
            <p className="max-w-48 text-xs text-muted-foreground">Can be removed once their balance is settled.</p>
          )}
        </div>
      ) : null}
    </li>
  );
}

function InvitationRow({ invitation, canRevoke }: { invitation: OpenInvitation; canRevoke: boolean }) {
  const label = invitation.invitedEmail ? `Email invitation for ${invitation.invitedEmail}` : "Invite link";
  return (
    <li className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 text-sm">
        <p className="font-medium break-all">{label}</p>
        <p className="text-muted-foreground">
          {invitation.useCount} of {invitation.maxUses} used · expires{" "}
          {dateFormat.format(new Date(invitation.expiresAt))} · by {invitation.createdByName}
        </p>
      </div>
      {canRevoke ? (
        <ActionButton
          variant="destructive"
          confirm="Revoke this invitation? Nobody will be able to use it."
          confirmLabel="Revoke"
          action={revokeInvitation.bind(null, { invitationId: invitation.id })}
        >
          Revoke
        </ActionButton>
      ) : null}
    </li>
  );
}
