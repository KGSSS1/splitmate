import { ArrowLeft, Copy, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CommentForm } from "@/components/expenses/comment-form";
import { FormStatus } from "@/components/forms/form-status";
import { ActionButton } from "@/components/shared/action-button";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUTES } from "@/lib/auth/routes";
import { formatExpenseDate, formatTimestamp } from "@/lib/expenses/dates";
import { ADJUSTMENT_LABELS, type AdjustmentKind, categoryLabel, isSplitMethod, SPLIT_METHOD_LABELS } from "@/lib/expenses/options";
import { formatBasisPoints } from "@/lib/expenses/percent";
import { formatMoney } from "@/lib/money/format";
import { cn } from "@/lib/utils";
import { uuidSchema } from "@/lib/validation/groups";
import { cancelExpense, deleteComment } from "@/server/actions/expenses";
import { requireOnboardedProfile } from "@/server/auth";
import { type ExpenseDetail, getExpense } from "@/server/expenses";
import { nameOf } from "@/server/people";

export const metadata: Metadata = { title: "Expense" };

const SAVED_MESSAGES: Record<string, string> = {
  created: "Expense saved. Balances are updated.",
  updated: "Changes saved. The previous version is in the history below.",
  unchanged: "Nothing changed, so nothing was saved.",
};

export default async function ExpensePage({ params, searchParams }: PageProps<"/expenses/[expenseId]">) {
  const [{ expenseId }, { saved }, profile] = await Promise.all([params, searchParams, requireOnboardedProfile()]);
  if (!uuidSchema.safeParse(expenseId).success) notFound();
  const expense = await getExpense(expenseId);
  if (!expense) notFound();

  const name = (id: string) => (id === profile.id ? "You" : nameOf(expense.people, id));
  const format = (amount: number) => formatMoney(amount, expense.currency);
  const cancelled = expense.status === "cancelled";
  const back = expense.groupId
    ? { href: `${ROUTES.groups}/${expense.groupId}`, label: expense.groupName ?? "Group" }
    : { href: `${ROUTES.friends}/${expense.friendId}`, label: expense.friendId ? nameOf(expense.people, expense.friendId) : "Friend" };
  const method = isSplitMethod(expense.splitMethod) ? SPLIT_METHOD_LABELS[expense.splitMethod] : expense.splitMethod;
  const savedMessage = typeof saved === "string" ? SAVED_MESSAGES[saved] : undefined;

  return (
    <div className="grid max-w-3xl gap-6">
      <Link
        href={back.href}
        className="inline-flex min-h-11 items-center gap-1 justify-self-start text-sm text-muted-foreground hover:text-foreground md:min-h-0"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {back.label}
      </Link>

      {savedMessage ? <FormStatus success={savedMessage} /> : null}

      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className={cn("text-2xl font-semibold tracking-tight break-words md:text-3xl", cancelled && "line-through")}>
            {expense.description}
          </h1>
          {cancelled ? (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">Cancelled</span>
          ) : null}
        </div>
        <p className="text-3xl font-semibold tabular-nums">{format(expense.amount)}</p>
        <p className="text-sm text-muted-foreground">
          {formatExpenseDate(expense.expenseDate)}
          {expense.category ? ` · ${categoryLabel(expense.category)}` : ""} · {expense.groupId ? expense.groupName : "Direct expense"}
          {expense.version > 1 ? ` · Version ${expense.version}` : ""}
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {expense.canChange ? (
          <Link href={`${ROUTES.expenses}/${expense.id}/edit`} className={cn(buttonVariants(), "h-11 md:h-8")}>
            <Pencil aria-hidden />
            Edit
          </Link>
        ) : null}
        {expense.canComment ? (
          <Link
            href={`${ROUTES.newExpense}?from=${expense.id}`}
            className={cn(buttonVariants({ variant: "outline" }), "h-11 md:h-8")}
          >
            <Copy aria-hidden />
            Duplicate
          </Link>
        ) : null}
        {expense.canChange ? (
          <ActionButton
            variant="destructive"
            confirm="Cancel this expense? Its effect on everyone's balances is reversed. It stays in the history."
            confirmLabel="Cancel expense"
            action={cancelExpense.bind(null, { expenseId: expense.id, expectedVersion: expense.version })}
          >
            Cancel expense
          </ActionButton>
        ) : null}
      </div>
      {expense.lockedReason && !cancelled ? <p className="text-sm text-muted-foreground">{expense.lockedReason}</p> : null}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Paid by</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1.5 text-sm" aria-label="Paid by">
              {expense.payers.map((payer) => (
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
          <CardContent className="grid gap-2">
            <SharesList expense={expense} name={name} format={format} />
          </CardContent>
        </Card>
      </div>

      {expense.items.length > 0 ? <ItemsCard expense={expense} name={name} format={format} /> : null}

      {expense.notes || expense.tags.length > 0 ? (
        <Card>
          <CardContent className="grid gap-3 text-sm">
            {expense.notes ? <p className="whitespace-pre-line">{expense.notes}</p> : null}
            {expense.tags.length > 0 ? (
              <ul className="flex flex-wrap gap-2" aria-label="Tags">
                {expense.tags.map((tag) => (
                  <li key={tag} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                    #{tag}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <section aria-labelledby="history-heading" className="grid gap-3">
        <h2 id="history-heading" className="text-lg font-semibold">
          History
        </h2>
        <ol className="grid gap-4 border-l pl-4" aria-label="History">
          {expense.history.map((entry) => (
            <li key={entry.id} className="grid gap-1.5 text-sm">
              <p>
                <span className="font-medium">{entry.actorName}</span>{" "}
                {entry.action === "created" ? "added this expense" : entry.action === "cancelled" ? "cancelled it" : "edited it"}
                <span className="text-muted-foreground"> · {formatTimestamp(entry.at, profile.timezone)}</span>
              </p>
              {entry.changes.length > 0 ? (
                <dl className="grid gap-1 text-xs sm:grid-cols-[auto_1fr] sm:gap-x-4">
                  {entry.changes.map((change) => (
                    <div key={change.label} className="contents">
                      <dt className="text-muted-foreground">{change.label}</dt>
                      <dd>
                        <span className="text-muted-foreground line-through">{change.before}</span>{" "}
                        <span aria-hidden>→</span>
                        <span className="sr-only">changed to</span> {change.after}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="comments-heading" className="grid gap-3">
        <h2 id="comments-heading" className="text-lg font-semibold">
          Comments
        </h2>
        {expense.comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No comments yet.</p>
        ) : (
          <ul className="grid gap-3" aria-label="Comments">
            {expense.comments.map((comment) => (
              <li key={comment.id} className="grid gap-1 rounded-lg border p-3 text-sm">
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{comment.authorId === profile.id ? "You" : comment.authorName}</span>
                  <span className="text-xs text-muted-foreground">{formatTimestamp(comment.createdAt, profile.timezone)}</span>
                </p>
                <p className="whitespace-pre-line">{comment.body}</p>
                {comment.authorId === profile.id && expense.canComment ? (
                  <ActionButton variant="ghost" action={deleteComment.bind(null, { commentId: comment.id })}>
                    Delete
                  </ActionButton>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {expense.canComment ? <CommentForm expenseId={expense.id} /> : null}
      </section>
    </div>
  );
}

function SharesList({
  expense,
  name,
  format,
}: {
  expense: ExpenseDetail;
  name: (id: string) => string;
  format: (amount: number) => string;
}) {
  const detail = new Map(expense.participants.map((p) => [p.userId, p]));
  const rounded = expense.shares.some((share) => share.roundingUnit);
  return (
    <>
      <ul className="grid gap-1.5 text-sm" aria-label="Shares">
        {[...expense.shares]
          .sort((a, b) => name(a.userId).localeCompare(name(b.userId)))
          .map((share) => {
            const row = detail.get(share.userId);
            const extra =
              row?.basisPoints != null
                ? `${formatBasisPoints(row.basisPoints)}%`
                : row?.weight != null && expense.splitMethod === "shares"
                  ? `${row.weight} ${row.weight === 1 ? "share" : "shares"}`
                  : null;
            return (
              <li key={share.userId} className="flex justify-between gap-3">
                <span>
                  {name(share.userId)}
                  {extra ? <span className="text-muted-foreground"> · {extra}</span> : null}
                </span>
                <span className="tabular-nums">
                  {share.roundingUnit ? (
                    <span className="mr-1.5 text-xs text-muted-foreground">
                      +1<span className="sr-only"> rounding unit</span>
                    </span>
                  ) : null}
                  {format(share.amount)}
                </span>
              </li>
            );
          })}
      </ul>
      {rounded ? (
        <p className="text-xs text-muted-foreground">+1: received a leftover unit so the shares add up exactly.</p>
      ) : null}
    </>
  );
}

function ItemsCard({
  expense,
  name,
  format,
}: {
  expense: ExpenseDetail;
  name: (id: string) => string;
  format: (amount: number) => string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Items</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2 text-sm" aria-label="Items">
          {expense.items.map((item, index) => (
            <li key={index} className="flex justify-between gap-3">
              <span className="min-w-0">
                {item.kind === "item" ? item.name : ADJUSTMENT_LABELS[item.kind as AdjustmentKind] ?? item.name}
                <span className="block text-xs text-muted-foreground">
                  {item.kind === "item"
                    ? item.assignees.map(name).join(", ")
                    : item.allocation === "equal"
                      ? "Split equally"
                      : "Split in proportion to items"}
                </span>
              </span>
              <span className="tabular-nums">
                {item.kind === "discount" ? "−" : ""}
                {format(item.amount)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
