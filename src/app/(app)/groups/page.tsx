import { ChevronRight, Plus, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { FormStatus } from "@/components/forms/form-status";
import { GroupTypeIcon } from "@/components/groups/group-type-icon";
import { ActionButton } from "@/components/shared/action-button";
import { BalanceText } from "@/components/shared/balance-text";
import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUTES } from "@/lib/auth/routes";
import { GROUP_TYPE_LABELS } from "@/lib/groups/options";
import { cn } from "@/lib/utils";
import { acceptInvitationById } from "@/server/actions/invitations";
import { requireOnboardedProfile } from "@/server/auth";
import { listMyGroups, listMyInvitations } from "@/server/groups";

export const metadata: Metadata = { title: "Groups" };

export default async function GroupsPage({ searchParams }: PageProps<"/groups">) {
  await requireOnboardedProfile();
  const [groups, invitations] = await Promise.all([listMyGroups(), listMyInvitations()]);

  return (
    <div className="grid max-w-3xl gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Groups</h1>
          <p className="text-muted-foreground">Trips, homes, couples and anything else you share costs in.</p>
        </div>
        <Link href={ROUTES.newGroup} className={cn(buttonVariants(), "h-11 md:h-9")}>
          <Plus aria-hidden />
          New group
        </Link>
      </header>

      <Suspense fallback={null}>
        <LeftNotice searchParams={searchParams} />
      </Suspense>

      {invitations.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Invitations for you</h2>
            </CardTitle>
            <CardDescription>Sent to your email address.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-4">
              {invitations.map((invitation) => (
                <li key={invitation.invitationId} className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex items-center gap-3">
                    <GroupTypeIcon type={invitation.groupType} />
                    <span>
                      <span className="block font-medium">{invitation.groupName}</span>
                      <span className="text-sm text-muted-foreground">Invited by {invitation.inviterName}</span>
                    </span>
                  </span>
                  <ActionButton
                    variant="default"
                    action={acceptInvitationById.bind(null, { invitationId: invitation.invitationId })}
                  >
                    Join group
                  </ActionButton>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {groups.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No groups yet"
          action={
            <Link href={ROUTES.newGroup} className={cn(buttonVariants({ variant: "outline" }), "h-11 md:h-9")}>
              Create your first group
            </Link>
          }
        >
          <p>Create a group for a trip, your home or anything you share, then invite people with a link.</p>
        </EmptyState>
      ) : (
        <ul className="divide-y rounded-xl border" aria-label="Your groups">
          {groups.map((group) => (
            <li key={group.id}>
              <Link
                href={`${ROUTES.groups}/${group.id}`}
                className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
              >
                <GroupTypeIcon type={group.groupType} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{group.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {GROUP_TYPE_LABELS[group.groupType]} · {group.memberCount}{" "}
                    {group.memberCount === 1 ? "member" : "members"}
                  </span>
                  <BalanceText balances={group.myBalances} perspective="self" />
                </span>
                <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function LeftNotice({ searchParams }: Pick<PageProps<"/groups">, "searchParams">) {
  const { left } = await searchParams;
  return left === "1" ? <FormStatus success="You left the group. Its history is still in your records." /> : null;
}
