import { ChevronRight, Search, UserRound, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { ExpenseList } from "@/components/expenses/expense-list";
import { EmptyState } from "@/components/shared/empty-state";
import { Pager } from "@/components/shared/pager";
import { ROW_LINK_CLASS } from "@/components/shared/row-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROUTES } from "@/lib/auth/routes";
import { SEARCH_MAX_LENGTH, SEARCH_MIN_LENGTH } from "@/lib/search/match";
import { cn } from "@/lib/utils";
import { settlementPageSchema } from "@/lib/validation/settlements";
import { requireOnboardedProfile } from "@/server/auth";
import { search } from "@/server/search";

export const metadata: Metadata = { title: "Search" };

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * Search across the viewer's friends, groups and the expenses they can see
 * (SPEC §9 screen 15). A plain GET form, so it works before JavaScript loads
 * and results have shareable URLs.
 */
export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const [params] = await Promise.all([searchParams, requireOnboardedProfile()]);
  const query = first(params.q).trim().slice(0, SEARCH_MAX_LENGTH);
  const page = settlementPageSchema.parse(params.page);
  const ready = query.length >= SEARCH_MIN_LENGTH;
  const results = ready ? await search(query, page) : null;
  if (results && page > results.pageCount) notFound();

  return (
    <div className="grid max-w-3xl gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Search</h1>
        <p className="text-muted-foreground">Friends, groups and expenses you can see.</p>
      </header>

      <form role="search" action={ROUTES.search} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="grid flex-1 gap-2">
          <Label htmlFor="search-query">Search for</Label>
          <Input
            id="search-query"
            name="q"
            type="search"
            defaultValue={query}
            minLength={SEARCH_MIN_LENGTH}
            maxLength={SEARCH_MAX_LENGTH}
            placeholder="A name, group, expense, note or tag"
            autoComplete="off"
            className="h-11 md:h-9"
          />
        </div>
        <Button type="submit" className="h-11 md:h-9">
          <Search aria-hidden />
          Search
        </Button>
      </form>

      {results === null ? (
        query.length > 0 ? (
          <p className="text-sm text-muted-foreground" role="status">
            Type at least {SEARCH_MIN_LENGTH} characters.
          </p>
        ) : null
      ) : results.friends.length + results.groups.length + results.expenseTotal === 0 ? (
        <EmptyState icon={Search} title="No matches">
          <p>Nothing you can see matches “{query}”. Try fewer or shorter words.</p>
        </EmptyState>
      ) : (
        <div className="grid gap-8">
          <p className="sr-only" role="status">
            {results.friends.length} friends, {results.groups.length} groups and {results.expenseTotal} expenses match.
          </p>
          {results.friends.length > 0 ? (
            <ResultSection title="Friends" count={results.friends.length}>
              <LinkList
                label="Matching friends"
                items={results.friends.map((friend) => ({
                  id: friend.id,
                  href: `${ROUTES.friends}/${friend.id}`,
                  icon: <UserRound aria-hidden className="size-4 text-muted-foreground" />,
                  title: friend.displayName,
                  note: null,
                }))}
              />
            </ResultSection>
          ) : null}
          {results.groups.length > 0 ? (
            <ResultSection title="Groups" count={results.groups.length}>
              <LinkList
                label="Matching groups"
                items={results.groups.map((group) => ({
                  id: group.id,
                  href: `${ROUTES.groups}/${group.id}`,
                  icon: <Users aria-hidden className="size-4 text-muted-foreground" />,
                  title: group.name,
                  note: group.former ? "You left this group" : null,
                }))}
              />
            </ResultSection>
          ) : null}
          {results.expenseTotal > 0 ? (
            <ResultSection title="Expenses" count={results.expenseTotal}>
              <ExpenseList items={results.expenses} label="Matching expenses" />
              <Pager
                base={ROUTES.search}
                page={results.page}
                pageCount={results.pageCount}
                query={{ q: query }}
                label="Expense result pages"
              />
            </ResultSection>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ResultSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const id = `results-${title.toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <h2 id={id} className="text-lg font-semibold">
        {title} <span className="text-sm font-normal text-muted-foreground">({count})</span>
      </h2>
      {children}
    </section>
  );
}

function LinkList({
  label,
  items,
}: {
  label: string;
  items: { id: string; href: string; icon: ReactNode; title: string; note: string | null }[];
}) {
  return (
    <ul className="divide-y rounded-xl border" aria-label={label}>
      {items.map((item) => (
        <li key={item.id}>
          <Link href={item.href} className={cn("flex min-h-14 items-center gap-3 px-4 py-3", ROW_LINK_CLASS)}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">{item.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{item.title}</span>
              {item.note ? <span className="block text-xs text-muted-foreground">{item.note}</span> : null}
            </span>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
