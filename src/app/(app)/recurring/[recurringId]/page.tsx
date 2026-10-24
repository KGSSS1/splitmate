import { ArrowLeft, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RedirectNotice } from "@/components/forms/redirect-notice";
import { RecurringStatusBadge } from "@/components/recurring/recurring-status-badge";
import { ActionButton } from "@/components/shared/action-button";
import { ROW_LINK_CLASS } from "@/components/shared/row-link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUTES } from "@/lib/auth/routes";
import { formatExpenseDate } from "@/lib/expenses/dates";
import { categoryLabel, isSplitMethod, SPLIT_METHOD_LABELS } from "@/lib/expenses/options";
import { formatMoney } from "@/lib/money/format";
import { describeSchedule } from "@/lib/recurring/schedule";
import { cn } from "@/lib/utils";
import { uuidSchema } from "@/lib/validation/groups";
import { setRecurringStatus } from "@/server/actions/recurring";
import { requireOnboardedProfile } from "@/server/auth";
import { getRecurring } from "@/server/recurring";
import { nameOf } from "@/server/people";

export const metadata: Metadata = { title: "Recurring expense" };

const SAVED_MESSAGES: Record<string, string> = {
  created: "Recurring expense saved. Anything due up to today has been added.",
  updated: "Changes saved. They apply to expenses added from now on.",
  unchanged: "Nothing changed, so nothing was saved.",
};

export default async function RecurringExpensePage({ params, searchParams }: PageProps<"/recurring/[recurringId]">) {
  const [{ recurringId }, { saved }, profile] = await Promise.all([params, searchParams, requireOnboardedProfile()]);
  if (!uuidSchema.safeParse(recurringId).success) notFound();
  const recurring = await getRecurring(recurringId);
  if (!recurring) notFound();

  const { stored } = recurring;
  const name = (id: string) => (id === profile.id ? "You" : nameOf(recurring.people, id));
  const format = (amount: number) => formatMoney(amount, stored.currency);
  const method = isSplitMethod(stored.splitMethod) ? SPLIT_METHOD_LABELS[stored.splitMethod] : stored.splitMethod;
  const where = recurring.groupId
    ? { href: `${ROUTES.groups}/${recurring.groupId}`, label: recurring.groupName ?? "Group" }
    : recurring.friendId
      ? { href: `${ROUTES.friends}/${recurring.friendId}`, label: nameOf(recurring.people, recurring.friendId) }
      : null;
  const savedMessage = typeof saved === "string" ? SAVED_MESSAGES[saved] : undefined;
  const status = (next: "paused" | "active" | "cancelled") =>
    setRecurringStatus.bind(null, { recurringId: recurring.id, status: next });

  return (
    <div className="grid max-w-3xl gap-6">
      <Link
        href={ROUTES.recurring}
        className="inline-flex min-h-11 items-center gap-1 justify-self-start text-sm text-muted-foreground hover:text-foreground md:min-h-0"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Recurring expenses
      </Link>

      {savedMessage ? <RedirectNotice param="saved" message={savedMessage} /> : null}

      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight break-words md:text-3xl">{stored.description}</h1>
          <RecurringStatusBadge status={recurring.status} />
        </div>
        <p className="text-3xl font-semibold tabular-nums">{format(stored.amount)}</p>
        <p className="text-sm text-muted-foreground">
          {describeSchedule(recurring.startDate, recurring.frequency)}
          {stored.category ? ` · ${categoryLabel(stored.category)}` : ""}
          {where ? (
            <>
              {" · "}
              <Link href={where.href} className="underline underline-offset-2 hover:text-foreground">
                {where.label}
              </Link>
            </>
          ) : null}
        </p>
      </header>

      {recurring.canManage ? (
        <div className="flex flex-wrap gap-2">
          <Link href={`${ROUTES.recurring}/${recurring.id}/edit`} className={cn(buttonVariants(), "h-11 md:h-8")}>
            <Pencil aria-hidden />
            Edit
          </Link>
          {recurring.status === "active" ? <ActionButton action={status("paused")}>Pause</ActionButton> : null}
          {recurring.status === "paused" ? <ActionButton action={status("active")}>Resume</ActionButton> : null}
          <ActionButton
            variant="destructive"
            confirm="Cancel this recurring expense? No more expenses are added. Expenses it already added stay."
            confirmLabel="Cancel recurring expense"
            action={status("cancelled")}
          >
            Cancel recurring expense
          </ActionButton>
        </div>
      ) : recurring.lockedReason ? (
        <p className="text-sm text-muted-foreground">{recurring.lockedReason}</p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Schedule</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-6">
            <dt className="text-muted-foreground">First date</dt>
            <dd>{formatExpenseDate(recurring.startDate)}</dd>
            <dt className="text-muted-foreground">Ends</dt>
            <dd>{recurring.endDate ? formatExpenseDate(recurring.endDate) : "No end date"}</dd>
            <dt className="text-muted-foreground">Next expense</dt>
            <dd>
              {recurring.status === "active" && recurring.nextDate
                ? formatExpenseDate(recurring.nextDate)
                : recurring.status === "paused"
                  ? "Paused: resume it to continue"
                  : "None"}
            </dd>
            <dt className="text-muted-foreground">Time zone</dt>
            <dd>{recurring.timezone.replaceAll("_", " ")}</dd>
          </dl>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Paid by</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1.5 text-sm" aria-label="Paid by">
              {stored.payers.map((payer) => (
                <li key={payer.userId} className="flex justify-between gap-3">
                  <span>{name(payer.userId)}</span>
                  <span className="tabular-nums">{format(payer.amount)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Split {method.toLowerCase()}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1.5 text-sm" aria-label="Shares">
              {recurring.shares.map((share) => (
                <li key={share.userId} className="flex justify-between gap-3">
                  <span>{name(share.userId)}</span>
                  <span className="tabular-nums">
                    {share.roundingUnit ? (
                      <span className="mr-1.5 text-xs text-muted-foreground">
                        +1<span className="sr-only"> rounding unit</span>
                      </span>
                    ) : null}
                    {format(share.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="added-heading" className="grid gap-3">
        <h2 id="added-heading" className="text-lg font-semibold">
          Expenses added
        </h2>
        {recurring.occurrences.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet. The first one is added on its date.</p>
        ) : (
          <ul className="divide-y rounded-xl border" aria-label="Expenses added">
            {recurring.occurrences.map((occurrence) =>
              occurrence.expenseId ? (
                <li key={occurrence.date}>
                  <Link
                    href={`${ROUTES.expenses}/${occurrence.expenseId}`}
                    className={cn("flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 text-sm", ROW_LINK_CLASS)}
                  >
                    <span>{formatExpenseDate(occurrence.date)}</span>
                    <span className="text-muted-foreground">View expense</span>
                  </Link>
                </li>
              ) : (
                <li key={occurrence.date} className="grid gap-0.5 px-4 py-2.5 text-sm">
                  <span>
                    {formatExpenseDate(occurrence.date)}
                    <span className="text-destructive-emphasis"> · {occurrence.status === "failed" ? "Not added" : "Skipped"}</span>
                  </span>
                  {occurrence.error ? <span className="text-muted-foreground">{occurrence.error}.</span> : null}
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
