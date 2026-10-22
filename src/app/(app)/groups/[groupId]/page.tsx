import { Plus, ReceiptText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ExpenseList } from "@/components/expenses/expense-list";
import { FormStatus } from "@/components/forms/form-status";
import { GroupHeader } from "@/components/groups/group-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Pager } from "@/components/shared/pager";
import { buttonVariants } from "@/components/ui/button";
import { ROUTES } from "@/lib/auth/routes";
import { cn } from "@/lib/utils";
import { expensePageSchema } from "@/lib/validation/expenses";
import { uuidSchema } from "@/lib/validation/groups";
import { requireOnboardedProfile } from "@/server/auth";
import { listGroupExpenses } from "@/server/expenses";
import { getGroup } from "@/server/groups";

export const metadata: Metadata = { title: "Group" };

/** Group expenses, newest first, 20 per page (`?page=`). */
export default async function GroupExpensesPage({ params, searchParams }: PageProps<"/groups/[groupId]">) {
  const [{ groupId }, query] = await Promise.all([params, searchParams, requireOnboardedProfile()]);
  if (!uuidSchema.safeParse(groupId).success) notFound();
  const view = await getGroup(groupId);
  if (!view) notFound();

  const page = expensePageSchema.parse(query.page);
  // Former members still see the group's expenses they were part of (RLS).
  const expenses = await listGroupExpenses(groupId, page);
  if (page > expenses.pageCount) notFound();
  const base = `${ROUTES.groups}/${groupId}`;
  const isMember = view.access === "member";

  return (
    <div className="grid max-w-3xl gap-6">
      <GroupHeader group={view.group} showTabs={isMember} />
      {query.joined === "1" && isMember ? <FormStatus success={`You joined ${view.group.name}.`} /> : null}
      {!isMember ? (
        <FormStatus error="You're no longer a member of this group. You can still see the expenses you were part of." />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          Expenses{expenses.total > 0 ? <span className="text-muted-foreground"> ({expenses.total})</span> : null}
        </h2>
        {isMember ? (
          <Link
            href={`${ROUTES.newExpense}?group=${groupId}`}
            className={cn(buttonVariants(), "h-11 md:h-9")}
          >
            <Plus aria-hidden />
            Add expense
          </Link>
        ) : null}
      </div>

      {expenses.items.length === 0 ? (
        <EmptyState icon={ReceiptText} title="No expenses yet">
          <p>Add the first expense to see who owes whom.</p>
        </EmptyState>
      ) : (
        <ExpenseList items={expenses.items} label="Group expenses" />
      )}

      <Pager base={base} page={page} pageCount={expenses.pageCount} label="Expense pages" />
    </div>
  );
}
