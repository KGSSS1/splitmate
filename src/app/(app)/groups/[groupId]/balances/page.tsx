import { HandCoins, Scale } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FormStatus } from "@/components/forms/form-status";
import { GroupHeader } from "@/components/groups/group-header";
import { SettlementList } from "@/components/settlements/settlement-list";
import { SuggestedTransfers } from "@/components/settlements/suggested-transfers";
import { BalanceText } from "@/components/shared/balance-text";
import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { ROUTES } from "@/lib/auth/routes";
import { suggestionsExplanation } from "@/lib/groups/copy";
import { cn } from "@/lib/utils";
import { uuidSchema } from "@/lib/validation/groups";
import { requireOnboardedProfile } from "@/server/auth";
import { getGroupSuggestions } from "@/server/balances";
import { getGroup } from "@/server/groups";
import { listSettlements } from "@/server/settlements";

export const metadata: Metadata = { title: "Group balances" };

/**
 * Each member's net per currency (from the ledger), suggested repayments
 * (labelled "simplified" when the group's toggle is on, SPEC §7), and the
 * group's settlements.
 */
export default async function GroupBalancesPage({ params }: PageProps<"/groups/[groupId]/balances">) {
  const [{ groupId }, profile] = await Promise.all([params, requireOnboardedProfile()]);
  if (!uuidSchema.safeParse(groupId).success) notFound();
  const view = await getGroup(groupId);
  if (!view) notFound();

  if (view.access === "former") {
    return (
      <div className="grid max-w-3xl gap-6">
        <GroupHeader group={view.group} showTabs={false} />
        <FormStatus error="You're no longer a member of this group. Ask a member for a new invitation to rejoin." />
      </div>
    );
  }

  const { group, members } = view;
  const [transfers, settlements] = await Promise.all([
    getGroupSuggestions(groupId, group.simplifyDebts),
    listSettlements({ kind: "group", groupId }),
  ]);
  const names = new Map(members.map((member) => [member.userId, member.displayName]));
  const nameOf = (userId: string) => names.get(userId) ?? "Former member";
  const owing = members.filter((member) => member.balances.length > 0);

  return (
    <div className="grid max-w-3xl gap-6">
      <GroupHeader group={group} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Balances</h2>
        <Link href={`${ROUTES.settleUp}?group=${groupId}`} className={cn(buttonVariants(), "h-11 md:h-9")}>
          <HandCoins aria-hidden />
          Settle up
        </Link>
      </div>

      {owing.length === 0 ? (
        <EmptyState icon={Scale} title="Everyone is settled up">
          <p>Nobody in this group owes anyone right now.</p>
        </EmptyState>
      ) : (
        <ul className="divide-y rounded-xl border" aria-label="Member balances">
          {members.map((member) => (
            <li key={member.userId} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
              <span className="font-medium">
                {member.displayName}
                {member.userId === profile.id ? <span className="text-muted-foreground"> (you)</span> : null}
              </span>
              <BalanceText
                balances={member.balances}
                perspective={member.userId === profile.id ? "self" : "member"}
                className="text-right"
              />
            </li>
          ))}
        </ul>
      )}

      {transfers.length > 0 ? (
        <section aria-labelledby="suggested-heading" className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="suggested-heading" className="text-lg font-semibold">
              Suggested repayments
            </h2>
            {group.simplifyDebts ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary-emphasis">Simplified</span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {suggestionsExplanation({ simplify: group.simplifyDebts, isAdmin: view.isAdmin })}
          </p>
          <SuggestedTransfers groupId={groupId} transfers={transfers} viewerId={profile.id} nameOf={nameOf} />
        </section>
      ) : null}

      <section aria-labelledby="settlements-heading" className="grid gap-3">
        <h2 id="settlements-heading" className="text-lg font-semibold">
          Settlements
          {settlements.total > 0 ? <span className="text-muted-foreground"> ({settlements.total})</span> : null}
        </h2>
        {settlements.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No repayments recorded in this group yet.</p>
        ) : (
          <SettlementList
            items={settlements.items}
            viewerId={profile.id}
            label="Group settlements"
            showActions
            showGroup={false}
          />
        )}
        {settlements.pageCount > 1 ? (
          <Link href={ROUTES.settlements} className="text-sm underline">
            See all your settlements
          </Link>
        ) : null}
      </section>
    </div>
  );
}
