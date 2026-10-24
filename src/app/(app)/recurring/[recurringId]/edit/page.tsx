import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ExpenseForm } from "@/components/expenses/expense-form";
import { ROUTES } from "@/lib/auth/routes";
import { storedToFormValues } from "@/lib/expenses/form-values";
import { uuidSchema } from "@/lib/validation/groups";
import { requireOnboardedProfile } from "@/server/auth";
import { getExpenseFormOptions } from "@/server/expenses";
import { getRecurring } from "@/server/recurring";

export const metadata: Metadata = { title: "Edit recurring expense" };

export default async function EditRecurringPage({ params }: PageProps<"/recurring/[recurringId]/edit">) {
  const [{ recurringId }] = await Promise.all([params, requireOnboardedProfile()]);
  if (!uuidSchema.safeParse(recurringId).success) notFound();
  const [recurring, options] = await Promise.all([getRecurring(recurringId), getExpenseFormOptions()]);
  if (!recurring) notFound();
  // Cancelled or no longer allowed: the detail page explains why.
  if (!recurring.canManage) redirect(`${ROUTES.recurring}/${recurringId}`);

  const splitWith = recurring.groupId ? `group:${recurring.groupId}` : `friend:${recurring.friendId}`;
  const group = recurring.groupId ? options.groups.find((g) => g.id === recurring.groupId) : undefined;
  const userIds = group ? group.members.map((member) => member.id) : [options.me.id, recurring.friendId ?? ""];

  return (
    <div className="grid max-w-5xl gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Edit recurring expense</h1>
        <p className="text-muted-foreground">
          Changes apply to expenses added from now on. Expenses already added keep their amounts.
        </p>
      </header>
      <ExpenseForm
        options={options}
        defaultValues={{
          ...storedToFormValues(recurring.stored, { splitWith, userIds }),
          repeat: {
            frequency: recurring.frequency,
            endDate: recurring.endDate ?? "",
            timezone: recurring.timezone,
          },
        }}
        mode={{ kind: "edit-recurring", recurringId, expectedVersion: recurring.version }}
      />
    </div>
  );
}
