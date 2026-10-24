import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Newer / Older links for a list paged with `?page=` (page 1 has no page
 * parameter). `query` keeps other parameters, such as a search. Nothing for a
 * single page.
 */
export function Pager({
  base,
  page,
  pageCount,
  label,
  query = {},
  newerLabel = "Newer",
  olderLabel = "Older",
}: {
  base: string;
  page: number;
  pageCount: number;
  label: string;
  query?: Record<string, string>;
  newerLabel?: string;
  olderLabel?: string;
}) {
  if (pageCount <= 1) return null;
  const href = (target: number) => {
    const params = new URLSearchParams(query);
    if (target > 1) params.set("page", String(target));
    const search = params.toString();
    return search ? `${base}?${search}` : base;
  };
  return (
    <nav aria-label={label} className="flex items-center justify-between gap-3 text-sm">
      {page > 1 ? (
        <Link
          href={href(page - 1)}
          className={cn(buttonVariants({ variant: "outline" }), "h-11 md:h-9")}
        >
          <ChevronLeft aria-hidden />
          {newerLabel}
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted-foreground">
        Page {page} of {pageCount}
      </span>
      {page < pageCount ? (
        <Link href={href(page + 1)} className={cn(buttonVariants({ variant: "outline" }), "h-11 md:h-9")}>
          {olderLabel}
          <ChevronRight aria-hidden />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
