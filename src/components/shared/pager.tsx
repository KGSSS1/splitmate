import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Newer / Older links for a list paged with `?page=` (page 1 is the bare URL). Nothing for a single page. */
export function Pager({ base, page, pageCount, label }: { base: string; page: number; pageCount: number; label: string }) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label={label} className="flex items-center justify-between gap-3 text-sm">
      {page > 1 ? (
        <Link
          href={page === 2 ? base : `${base}?page=${page - 1}`}
          className={cn(buttonVariants({ variant: "outline" }), "h-11 md:h-9")}
        >
          <ChevronLeft aria-hidden />
          Newer
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted-foreground">
        Page {page} of {pageCount}
      </span>
      {page < pageCount ? (
        <Link href={`${base}?page=${page + 1}`} className={cn(buttonVariants({ variant: "outline" }), "h-11 md:h-9")}>
          Older
          <ChevronRight aria-hidden />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
