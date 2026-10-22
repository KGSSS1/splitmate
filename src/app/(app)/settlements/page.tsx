import { HandCoins } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SettlementList } from "@/components/settlements/settlement-list";
import { EmptyState } from "@/components/shared/empty-state";
import { Pager } from "@/components/shared/pager";
import { buttonVariants } from "@/components/ui/button";
import { ROUTES } from "@/lib/auth/routes";
import { cn } from "@/lib/utils";
import { settlementPageSchema } from "@/lib/validation/settlements";
import { requireOnboardedProfile } from "@/server/auth";
import { listPendingSettlements, listSettlements } from "@/server/settlements";

export const metadata: Metadata = { title: "Settlements" };

/** Every settlement the viewer paid or received: what needs an answer first, then the full history. */
export default async function SettlementsPage({ searchParams }: PageProps<"/settlements">) {
  const [query, profile] = await Promise.all([searchParams, requireOnboardedProfile()]);
  const page = settlementPageSchema.parse(query.page);
  const [pending, history] = await Promise.all([listPendingSettlements(), listSettlements({ kind: "mine" }, page)]);
  if (page > history.pageCount) notFound();

  return (
    <div className="grid max-w-3xl gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Settlements</h1>
          <p className="text-muted-foreground">Repayments you made or received. Only completed ones count in balances.</p>
        </div>
        <Link href={ROUTES.settleUp} className={cn(buttonVariants(), "h-11 md:h-9")}>
          <HandCoins aria-hidden />
          Settle up
        </Link>
      </header>

      {pending.toConfirm.length > 0 ? (
        <section aria-labelledby="to-confirm-heading" className="grid gap-3">
          <h2 id="to-confirm-heading" className="text-lg font-semibold">
            Waiting for you to confirm
          </h2>
          <SettlementList items={pending.toConfirm} viewerId={profile.id} label="Waiting for you" showActions />
        </section>
      ) : null}

      {pending.waiting.length > 0 ? (
        <section aria-labelledby="waiting-heading" className="grid gap-3">
          <h2 id="waiting-heading" className="text-lg font-semibold">
            Waiting for others
          </h2>
          <SettlementList items={pending.waiting} viewerId={profile.id} label="Waiting for others" />
        </section>
      ) : null}

      <section aria-labelledby="history-heading" className="grid gap-3">
        <h2 id="history-heading" className="text-lg font-semibold">
          History{history.total > 0 ? <span className="text-muted-foreground"> ({history.total})</span> : null}
        </h2>
        {history.items.length === 0 ? (
          <EmptyState icon={HandCoins} title="No settlements yet">
            <p>When you pay someone back or they pay you, record it here so balances stay right.</p>
          </EmptyState>
        ) : (
          <SettlementList items={history.items} viewerId={profile.id} label="Settlement history" />
        )}
        <Pager base={ROUTES.settlements} page={page} pageCount={history.pageCount} label="Settlement pages" />
      </section>
    </div>
  );
}
