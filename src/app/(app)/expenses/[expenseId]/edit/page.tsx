import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ExpenseForm } from "@/components/expenses/expense-form";
import { ROUTES } from "@/lib/auth/routes";
import { storedToFormValues } from "@/lib/expenses/form-values";
import { uuidSchema } from "@/lib/validation/groups";
import { requireOnboardedProfile } from "@/server/auth";
import { getExpense, getExpenseFormOptions } from "@/server/expenses";

export const metadata: Metadata = { title: "Edit expense" };

export default async function EditExpensePage({ params }: PageProps<"/expenses/[expenseId]/edit">) {
  const [{ expenseId }] = await Promise.all([params, requireOnboardedProfile()]);
  if (!uuidSchema.safeParse(expenseId).success) notFound();
  const [expense, options] = await Promise.all([getExpense(expenseId), getExpenseFormOptions()]);
  if (!expense) notFound();
  // Cancelled, frozen or no longer allowed: the detail page explains why.
  if (!expense.canChange) redirect(`${ROUTES.expenses}/${expenseId}`);

  const splitWith = expense.groupId ? `group:${expense.groupId}` : `friend:${expense.friendId}`;
  const group = expense.groupId ? options.groups.find((g) => g.id === expense.groupId) : undefined;
  const userIds = group ? group.members.map((member) => member.id) : [options.me.id, expense.friendId ?? ""];

  return (
    <div className="grid max-w-5xl gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Edit expense</h1>
        <p className="text-muted-foreground">
          Saving keeps the old version in the history and updates everyone&apos;s balances.
        </p>
      </header>
      <ExpenseForm
        options={options}
        defaultValues={storedToFormValues(expense, { splitWith, userIds })}
        mode={{ kind: "edit", expenseId, expectedVersion: expense.version }}
      />
    </div>
  );
}
