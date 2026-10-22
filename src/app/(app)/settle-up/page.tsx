import { ArrowLeft, HandCoins } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { GroupTypeIcon } from "@/components/groups/group-type-icon";
import { type SettleUpSuggestion, SettleUpForm } from "@/components/settlements/settle-up-form";
import { BalanceText } from "@/components/shared/balance-text";
import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { ROUTES } from "@/lib/auth/routes";
import { todayIn } from "@/lib/expenses/dates";
import { isCurrencyCode } from "@/lib/money/currencies";
import { minorToDecimalString } from "@/lib/money/format";
import { parseMoney } from "@/lib/money/parse";
import type { SettlementDirection } from "@/lib/settlements/options";
import { transfersInvolving } from "@/lib/settlements/suggestions";
import { cn } from "@/lib/utils";
import { uuidSchema } from "@/lib/validation/groups";
import type { SettleUpFormValues } from "@/lib/validation/settlements";
import { requireOnboardedProfile } from "@/server/auth";
import { getFriendContextBalances, getGroupSuggestions } from "@/server/balances";
import { getFriend, getFriendsOverview } from "@/server/friends";
import { getGroup, listMyGroups } from "@/server/groups";

export const metadata: Metadata = { title: "Settle up" };

type Query = Record<string, string | string[] | undefined>;

function text(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function id(value: string | string[] | undefined): string | undefined {
  const candidate = text(value);
  return candidate && uuidSchema.safeParse(candidate).success ? candidate : undefined;
}

function toSuggestion(personId: string, direction: SettlementDirection, amount: number, currency: string) {
  return { personId, direction, amount, currency, amountText: minorToDecimalString(amount, currency) };
}

/**
 * Prefill: `?person=&direction=&amount=&currency=` from a suggestion link,
 * otherwise the first suggestion, otherwise an empty amount.
 */
function initialValues(
  query: Query,
  people: readonly { id: string }[],
  suggestions: readonly SettleUpSuggestion[],
  fallback: { personId: string; currency: string; today: string },
): SettleUpFormValues {
  const personId = id(query.person);
  const direction = text(query.direction);
  const currency = text(query.currency);
  const amount = text(query.amount);
  const requested: { personId: string; direction: SettlementDirection } | null =
    personId && people.some((person) => person.id === personId) && (direction === "paid" || direction === "received")
      ? { personId, direction }
      : null;
  const suggestion = requested ? null : suggestions[0];
  const chosenCurrency = currency && isCurrencyCode(currency) ? currency : (suggestion?.currency ?? fallback.currency);
  const chosenAmount =
    requested && amount && parseMoney(amount, chosenCurrency).ok ? amount : (suggestion?.amountText ?? "");

  return {
    personId: requested?.personId ?? suggestion?.personId ?? fallback.personId,
    direction: requested?.direction ?? suggestion?.direction ?? "paid",
    amount: chosenAmount,
    currency: chosenCurrency,
    method: "cash",
    upiReference: "",
    note: "",
    settledOn: fallback.today,
  };
}

/**
 * Settle-up flow (SPEC §9 screen 9, §11). Without `?group=` or `?friend=` it
 * asks where; with one it shows the form, prefilled from the suggestions.
 */
export default async function SettleUpPage({ searchParams }: PageProps<"/settle-up">) {
  const [query, profile] = await Promise.all([searchParams, requireOnboardedProfile()]);
  const groupId = id(query.group);
  const friendId = id(query.friend);
  const today = todayIn(profile.timezone);

  if (groupId) {
    const view = await getGroup(groupId);
    if (!view) notFound();
    if (view.access === "former") {
      return (
        <Shell back={`${ROUTES.groups}/${groupId}`} subtitle={view.group.name}>
          <p className="text-sm text-muted-foreground">
            You&apos;re no longer a member of this group, so you can&apos;t record settlements in it.
          </p>
        </Shell>
      );
    }
    const people = view.members
      .filter((member) => member.userId !== profile.id)
      .map((member) => ({ id: member.userId, name: member.displayName }));
    const transfers = transfersInvolving(await getGroupSuggestions(groupId, view.group.simplifyDebts), profile.id);
    const suggestions = transfers.map((transfer) =>
      transfer.fromUserId === profile.id
        ? toSuggestion(transfer.toUserId, "paid", transfer.amount, transfer.currency)
        : toSuggestion(transfer.fromUserId, "received", transfer.amount, transfer.currency),
    );
    return (
      <Shell back={`${ROUTES.groups}/${groupId}/balances`} subtitle={`In ${view.group.name}`}>
        {people.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody else is in this group yet.</p>
        ) : (
          <SettleUpForm
            groupId={groupId}
            people={people}
            suggestions={suggestions}
            defaultValues={initialValues(query, people, suggestions, {
              personId: "",
              currency: view.group.defaultCurrency,
              today,
            })}
          />
        )}
      </Shell>
    );
  }

  if (friendId) {
    const friend = await getFriend(friendId);
    if (!friend) notFound();
    const balances = await getFriendContextBalances(friendId);
    const suggestions = balances
      .filter((balance) => balance.groupId === null)
      .map((balance) =>
        toSuggestion(friendId, balance.amount < 0 ? "paid" : "received", Math.abs(balance.amount), balance.currency),
      );
    const inGroups = balances.some((balance) => balance.groupId !== null);
    const people = [{ id: friend.id, name: friend.displayName }];
    return (
      <Shell back={`${ROUTES.friends}/${friendId}`} subtitle={`With ${friend.displayName}, outside any group`}>
        {inGroups ? (
          <p className="rounded-lg border bg-muted/40 p-3 text-sm">
            You also have balances with {friend.displayName} in shared groups. To clear them all at once, use{" "}
            <Link href={`${ROUTES.friends}/${friendId}#settle-everything`} className="font-medium underline">
              Settle up everything
            </Link>
            .
          </p>
        ) : null}
        <SettleUpForm
          groupId={null}
          people={people}
          suggestions={suggestions}
          defaultValues={initialValues(query, people, suggestions, {
            personId: friend.id,
            currency: profile.default_currency,
            today,
          })}
        />
      </Shell>
    );
  }

  const [{ friends }, groups] = await Promise.all([getFriendsOverview(), listMyGroups()]);
  return (
    <Shell back={ROUTES.dashboard} subtitle="Who did you settle up with?">
      {friends.length === 0 && groups.length === 0 ? (
        <EmptyState icon={HandCoins} title="Nobody to settle up with">
          <p>Settlements are between you and a friend or someone in one of your groups.</p>
        </EmptyState>
      ) : null}
      {groups.length > 0 ? (
        <section aria-labelledby="groups-heading" className="grid gap-3">
          <h2 id="groups-heading" className="text-lg font-semibold">
            In a group
          </h2>
          <ul className="divide-y rounded-xl border" aria-label="Groups">
            {groups.map((group) => (
              <li key={group.id}>
                <Link
                  href={`${ROUTES.settleUp}?group=${group.id}`}
                  className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-muted/50"
                >
                  <GroupTypeIcon type={group.groupType} className="size-8" />
                  <span className="min-w-0 flex-1 truncate font-medium">{group.name}</span>
                  <BalanceText balances={group.myBalances} perspective="self" className="text-right" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {friends.length > 0 ? (
        <section aria-labelledby="friends-heading" className="grid gap-3">
          <h2 id="friends-heading" className="text-lg font-semibold">
            With a friend
          </h2>
          <p className="text-sm text-muted-foreground">
            For expenses between the two of you outside groups. Each balance is shown across everything you share.
          </p>
          <ul className="divide-y rounded-xl border" aria-label="Friends">
            {friends.map((friend) => (
              <li key={friend.id}>
                <Link
                  href={`${ROUTES.settleUp}?friend=${friend.id}`}
                  className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-muted/50"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{friend.displayName}</span>
                  <BalanceText balances={friend.balances} perspective="friend" className="text-right" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Shell>
  );
}

function Shell({ back, subtitle, children }: { back: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid max-w-2xl gap-6">
      <Link
        href={back}
        className="inline-flex min-h-11 items-center gap-1 justify-self-start text-sm text-muted-foreground hover:text-foreground md:min-h-0"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Back
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Settle up</h1>
          <p className="text-muted-foreground">{subtitle}</p>
        </div>
        {back !== ROUTES.dashboard ? (
          <Link href={ROUTES.settleUp} className={cn(buttonVariants({ variant: "ghost" }), "h-11 md:h-9")}>
            Someone else
          </Link>
        ) : null}
      </header>
      {children}
    </div>
  );
}
