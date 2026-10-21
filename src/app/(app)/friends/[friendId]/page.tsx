import { ArrowLeft, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ExpenseList } from "@/components/expenses/expense-list";
import { GroupTypeIcon } from "@/components/groups/group-type-icon";
import { BalanceText } from "@/components/shared/balance-text";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUTES } from "@/lib/auth/routes";
import { GROUP_TYPE_LABELS } from "@/lib/groups/options";
import { cn } from "@/lib/utils";
import { uuidSchema } from "@/lib/validation/groups";
import { requireOnboardedProfile } from "@/server/auth";
import { listDirectExpenses } from "@/server/expenses";
import { getFriend } from "@/server/friends";

export const metadata: Metadata = { title: "Friend" };

export default async function FriendPage({ params }: PageProps<"/friends/[friendId]">) {
  const [{ friendId }] = await Promise.all([params, requireOnboardedProfile()]);
  if (!uuidSchema.safeParse(friendId).success) notFound();
  const friend = await getFriend(friendId);
  if (!friend) notFound();
  const direct = await listDirectExpenses(friendId);

  return (
    <div className="grid max-w-3xl gap-6">
      <Link
        href={ROUTES.friends}
        className="inline-flex min-h-11 items-center gap-1 justify-self-start text-sm text-muted-foreground hover:text-foreground md:min-h-0"
      >
        <ArrowLeft aria-hidden className="size-4" />
        All friends
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{friend.displayName}</h1>
          {friend.since ? (
            <p className="text-muted-foreground">
              Friends since{" "}
              {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(friend.since))}
            </p>
          ) : null}
        </div>
        <Link href={`${ROUTES.newExpense}?friend=${friend.id}`} className={cn(buttonVariants(), "h-11 md:h-9")}>
          <Plus aria-hidden />
          Add expense
        </Link>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Balance</h2>
          </CardTitle>
          <CardDescription>Across all your shared groups and direct expenses, per currency.</CardDescription>
        </CardHeader>
        <CardContent>
          <BalanceText balances={friend.balances} perspective="friend" className="text-base" />
        </CardContent>
      </Card>

      <section aria-labelledby="direct-heading" className="grid gap-3">
        <h2 id="direct-heading" className="text-lg font-semibold">
          Expenses between you two
        </h2>
        {direct.length === 0 ? (
          <p className="text-sm text-muted-foreground">No direct expenses yet. Group expenses are in each group.</p>
        ) : (
          <ExpenseList items={direct} label="Direct expenses" />
        )}
      </section>

      <section aria-labelledby="shared-groups-heading" className="grid gap-3">
        <h2 id="shared-groups-heading" className="text-lg font-semibold">
          Groups you share
        </h2>
        {friend.sharedGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground">You aren&apos;t in any groups together right now.</p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {friend.sharedGroups.map((group) => (
              <li key={group.id}>
                <Link
                  href={`${ROUTES.groups}/${group.id}`}
                  className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-muted/50"
                >
                  <GroupTypeIcon type={group.groupType} className="size-8" />
                  <span className="min-w-0 flex-1 truncate font-medium">{group.name}</span>
                  <span className="text-xs text-muted-foreground">{GROUP_TYPE_LABELS[group.groupType]}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
