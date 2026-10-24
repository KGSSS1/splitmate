import { Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ExpenseForm } from "@/components/expenses/expense-form";
import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { ROUTES } from "@/lib/auth/routes";
import { todayIn } from "@/lib/expenses/dates";
import { blankExpenseValues, storedToFormValues } from "@/lib/expenses/form-values";
import { isFrequency } from "@/lib/recurring/schedule";
import { cn } from "@/lib/utils";
import { uuidSchema } from "@/lib/validation/groups";
import { noRepeat } from "@/lib/validation/recurring";
import { requireOnboardedProfile } from "@/server/auth";
import { type ExpenseFormOptions, getExpense, getExpenseFormOptions } from "@/server/expenses";

export const metadata: Metadata = { title: "Add expense" };

function first(value: string | string[] | undefined): string | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  return text && uuidSchema.safeParse(text).success ? text : undefined;
}

/** Where a new expense goes: the requested group or friend if the caller has it, else their first group or friend. */
function chooseSplitWith(options: ExpenseFormOptions, group?: string, friend?: string): string | null {
  if (group && options.groups.some((g) => g.id === group)) return `group:${group}`;
  if (friend && options.friends.some((f) => f.id === friend)) return `friend:${friend}`;
  if (options.groups[0]) return `group:${options.groups[0].id}`;
  if (options.friends[0]) return `friend:${options.friends[0].id}`;
  return null;
}

/**
 * New expense. `?group=` or `?friend=` preselects where it goes; `?from=`
 * duplicates an existing expense (dated today, saved as a new expense);
 * `?repeat=monthly` (or daily, weekly, yearly) starts a recurring one.
 */
export default async function NewExpensePage({ searchParams }: PageProps<"/expenses/new">) {
  const [query, profile] = await Promise.all([searchParams, requireOnboardedProfile()]);
  const options = await getExpenseFormOptions();
  const today = todayIn(profile.timezone);

  const original = first(query.from) ? await getExpense(first(query.from) ?? "") : null;
  // A duplicate keeps the split only where it still fits: the same group or friend, still yours.
  const source =
    original &&
    (original.groupId
      ? options.groups.some((g) => g.id === original.groupId)
      : options.friends.some((f) => f.id === original.friendId))
      ? original
      : null;
  const splitWith = source
    ? chooseSplitWith(options, source.groupId ?? undefined, source.friendId ?? undefined)
    : chooseSplitWith(options, first(query.group), first(query.friend));

  if (!splitWith) {
    return (
      <div className="grid max-w-3xl gap-6">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Add expense</h1>
        <EmptyState
          icon={Users}
          title="Nobody to split with yet"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link href={ROUTES.newGroup} className={cn(buttonVariants(), "h-11 md:h-9")}>
                Create a group
              </Link>
              <Link href={ROUTES.friends} className={cn(buttonVariants({ variant: "outline" }), "h-11 md:h-9")}>
                Add a friend
              </Link>
            </div>
          }
        >
          <p>Expenses are shared with a group or a friend. Create a group or add a friend first.</p>
        </EmptyState>
      </div>
    );
  }

  const group = splitWith.startsWith("group:")
    ? options.groups.find((g) => `group:${g.id}` === splitWith)
    : undefined;
  const userIds = group
    ? group.members.map((member) => member.id)
    : [options.me.id, splitWith.slice("friend:".length)];

  const defaultValues =
    source
      ? { ...storedToFormValues(source, { splitWith, userIds }), date: today }
      : blankExpenseValues({
          splitWith,
          userIds,
          paidBy: options.me.id,
          currency: group?.defaultCurrency ?? profile.default_currency,
          date: today,
        });

  const repeatParam = Array.isArray(query.repeat) ? query.repeat[0] : query.repeat;
  const repeat = { ...noRepeat(profile.timezone), ...(isFrequency(repeatParam) ? { frequency: repeatParam } : {}) };

  return (
    <div className="grid max-w-5xl gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          {source ? "Duplicate expense" : "Add expense"}
        </h1>
        <p className="text-muted-foreground">
          {source
            ? "A copy dated today. Change anything before saving it as a new expense."
            : "Shares are worked out as you type. Nothing is saved until you press Save."}
        </p>
      </header>
      <ExpenseForm options={options} defaultValues={{ ...defaultValues, repeat }} mode={{ kind: "create" }} />
    </div>
  );
}
