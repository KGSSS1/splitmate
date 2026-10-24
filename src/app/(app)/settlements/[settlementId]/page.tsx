import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FormStatus } from "@/components/forms/form-status";
import { SettlementActions } from "@/components/settlements/settlement-actions";
import { settlementSentence } from "@/components/settlements/settlement-list";
import { SettlementStatusBadge } from "@/components/settlements/settlement-status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { ROUTES } from "@/lib/auth/routes";
import { formatExpenseDate, formatTimestamp } from "@/lib/expenses/dates";
import { settlementMethodLabel } from "@/lib/settlements/options";
import { uuidSchema } from "@/lib/validation/groups";
import { requireOnboardedProfile } from "@/server/auth";
import { getSettlement, type SettlementDetail } from "@/server/settlements";

export const metadata: Metadata = { title: "Settlement" };


function statusExplanation(settlement: SettlementDetail, viewerId: string): string {
  switch (settlement.status) {
    case "pending":
      return settlement.receiverId === viewerId
        ? `${settlement.payerName} says they paid you. Confirm it once you've received the money; until then balances don't change.`
        : `Waiting for ${settlement.receiverName} to confirm. Balances change once they do.`;
    case "completed":
      return "Counted in balances.";
    case "rejected":
      return "The receiver said this payment didn't arrive. Balances were not changed.";
    case "withdrawn":
      return "Withdrawn before it was confirmed. It never changed balances.";
    case "cancelled":
      return "Cancelled after it was completed. Its effect on balances was reversed.";
  }
}

const SAVED_MESSAGES: Record<string, string> = {
  paid: "Payment recorded. It counts once the receiver confirms it.",
  received: "Payment recorded. Balances are updated.",
};

export default async function SettlementPage({ params, searchParams }: PageProps<"/settlements/[settlementId]">) {
  const [{ settlementId }, query, profile] = await Promise.all([params, searchParams, requireOnboardedProfile()]);
  if (!uuidSchema.safeParse(settlementId).success) notFound();
  const settlement = await getSettlement(settlementId);
  if (!settlement) notFound();
  const saved = typeof query.saved === "string" ? SAVED_MESSAGES[query.saved] : undefined;

  return (
    <div className="grid max-w-2xl gap-6">
      <Link
        href={settlement.groupId ? `${ROUTES.groups}/${settlement.groupId}/balances` : ROUTES.settlements}
        className="inline-flex min-h-11 items-center gap-1 justify-self-start text-sm text-muted-foreground hover:text-foreground md:min-h-0"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {settlement.groupId ? "Group balances" : "All settlements"}
      </Link>
      {saved ? <FormStatus success={saved} /> : null}

      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SettlementStatusBadge status={settlement.status} />
          <span className="text-sm text-muted-foreground">
            {settlement.groupId ? (
              <Link href={`${ROUTES.groups}/${settlement.groupId}`} className="underline">
                {settlement.groupName ?? "Group"}
              </Link>
            ) : (
              "Direct, outside any group"
            )}
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight tabular-nums md:text-3xl">
          {settlementSentence(settlement, profile.id)}
        </h1>
        <p className="text-muted-foreground">{statusExplanation(settlement, profile.id)}</p>
      </header>

      <SettlementActions settlement={settlement} viewerId={profile.id} />

      <Card>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Detail label="Paid on" value={formatExpenseDate(settlement.settledOn)} />
            <Detail label="Paid with" value={settlementMethodLabel(settlement.method)} />
            {settlement.upiReference ? <Detail label="UPI reference" value={settlement.upiReference} /> : null}
            {settlement.note ? <Detail label="Note" value={settlement.note} wide /> : null}
          </dl>
        </CardContent>
      </Card>

      <section aria-labelledby="history-heading" className="grid gap-3">
        <h2 id="history-heading" className="text-lg font-semibold">
          History
        </h2>
        <ol className="grid gap-3 border-l pl-4" aria-label="History">
          {settlement.history.map((event) => (
            <li key={event.id} className="grid gap-0.5 text-sm">
              <span>{event.title}</span>
              <span className="text-xs text-muted-foreground">
                {formatTimestamp(event.at, profile.timezone)}
                {event.effect ? ` · ${event.effect}` : ""}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Detail({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "grid gap-0.5 sm:col-span-2" : "grid gap-0.5"}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words whitespace-pre-line">{value}</dd>
    </div>
  );
}
