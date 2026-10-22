import { HandCoins, Plus, ReceiptText, UserPlus, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { ActivityList } from "@/components/activity/activity-list";
import { BalanceSummary } from "@/components/dashboard/balance-summary";
import { GroupTypeIcon } from "@/components/groups/group-type-icon";
import { SettlementList } from "@/components/settlements/settlement-list";
import { BalanceText } from "@/components/shared/balance-text";
import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { ROUTES } from "@/lib/auth/routes";
import { cn } from "@/lib/utils";
import { listActivity } from "@/server/activity";
import { requireOnboardedProfile } from "@/server/auth";
import { getBalanceSummary, listPersonBalances } from "@/server/balances";
import { listMyGroups } from "@/server/groups";
import { listPendingSettlements, listSettlements } from "@/server/settlements";

export const metadata: Metadata = { title: "Dashboard" };

const RECENT = 5;

/**
 * Where the viewer stands (SPEC §9): owed / owing / net per currency, who they
 * owe or are owed by, their groups, repayments waiting for them, recent
 * settlements and activity. Balances are net positions from the ledger, never
 * gross spending, and only completed repayments count in them.
 */
export default async function DashboardPage() {
  const profile = await requireOnboardedProfile();
  const [summaries, people, groups, pending, settlements, activity] = await Promise.all([
    getBalanceSummary(),
    listPersonBalances(),
    listMyGroups(),
    listPendingSettlements(),
    listSettlements({ kind: "mine" }),
    listActivity({ limit: RECENT }),
  ]);
  const groupsWithBalance = groups.filter((group) => group.myBalances.length > 0);

  return (
    <div className="grid gap-8">
      <header className="grid gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Hi, {profile.display_name}</h1>
          <p className="text-muted-foreground">Here&apos;s where you stand with everyone.</p>
        </div>
        <nav aria-label="Quick actions" className="flex flex-wrap gap-2">
          <QuickAction href={ROUTES.newExpense} icon={<Plus aria-hidden />} primary>
            Add expense
          </QuickAction>
          <QuickAction href={ROUTES.settleUp} icon={<HandCoins aria-hidden />}>
            Settle up
          </QuickAction>
          <QuickAction href={ROUTES.newGroup} icon={<Users aria-hidden />}>
            Create group
          </QuickAction>
          <QuickAction href={`${ROUTES.friends}#add-friend`} icon={<UserPlus aria-hidden />}>
            Invite a friend
          </QuickAction>
        </nav>
      </header>

      {summaries.length === 0 ? (
        <EmptyState icon={ReceiptText} title="No balances yet">
          <p>
            When you split an expense with a friend or a group, what you owe and what you&apos;re owed
            shows up here.
          </p>
        </EmptyState>
      ) : (
        <section aria-labelledby="totals-heading" className="grid gap-2">
          <h2 id="totals-heading" className="sr-only">
            Your balances
          </h2>
          <BalanceSummary summaries={summaries} />
          <p className="text-xs text-muted-foreground">
            Net balances across all groups and friends, per currency. Repayments count once they&apos;re completed.
          </p>
        </section>
      )}

      {pending.toConfirm.length > 0 ? (
        <Section id="confirm" title="Waiting for you to confirm" more={{ href: ROUTES.settlements, label: "All settlements" }}>
          <SettlementList items={pending.toConfirm} viewerId={profile.id} label="Waiting for you" showActions />
        </Section>
      ) : null}

      <div className="grid items-start gap-8 lg:grid-cols-2">
        <Section id="people" title="Balances by person" more={{ href: ROUTES.friends, label: "All friends" }}>
          {people.length === 0 ? (
            <p className="text-sm text-muted-foreground">You&apos;re settled up with everyone.</p>
          ) : (
            <ul className="divide-y rounded-xl border" aria-label="Balances by person">
              {people.map((person) => (
                <li key={person.personId}>
                  <Link
                    href={`${ROUTES.friends}/${person.personId}`}
                    className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50"
                  >
                    <span className="min-w-0 truncate font-medium">{person.displayName}</span>
                    <BalanceText balances={person.balances} perspective="friend" className="text-right" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="groups" title="Groups" more={{ href: ROUTES.groups, label: "All groups" }}>
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">You&apos;re not in any groups yet.</p>
          ) : (
            <ul className="divide-y rounded-xl border" aria-label="Group balances">
              {(groupsWithBalance.length > 0 ? groupsWithBalance : groups).slice(0, 6).map((group) => (
                <li key={group.id}>
                  <Link
                    href={`${ROUTES.groups}/${group.id}/balances`}
                    className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-muted/50"
                  >
                    <GroupTypeIcon type={group.groupType} className="size-8" />
                    <span className="min-w-0 flex-1 truncate font-medium">{group.name}</span>
                    <BalanceText balances={group.myBalances} perspective="self" className="text-right" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="settlements" title="Recent settlements" more={{ href: ROUTES.settlements, label: "All settlements" }}>
          {settlements.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No repayments recorded yet.</p>
          ) : (
            <SettlementList
              items={settlements.items.slice(0, RECENT)}
              viewerId={profile.id}
              label="Recent settlements"
            />
          )}
        </Section>

        <Section id="activity" title="Recent activity" more={{ href: ROUTES.activity, label: "All activity" }}>
          {activity.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <ActivityList items={activity.items} label="Recent activity" />
          )}
        </Section>
      </div>
    </div>
  );
}

function QuickAction({
  href,
  icon,
  primary = false,
  children,
}: {
  href: string;
  icon: ReactNode;
  primary?: boolean;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={cn(buttonVariants({ variant: primary ? "default" : "outline" }), "h-11 md:h-9")}>
      {icon}
      {children}
    </Link>
  );
}

function Section({
  id,
  title,
  more,
  children,
}: {
  id: string;
  title: string;
  more: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="grid gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={`${id}-heading`} className="text-lg font-semibold">
          {title}
        </h2>
        <Link href={more.href} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          {more.label}
        </Link>
      </div>
      {children}
    </section>
  );
}
