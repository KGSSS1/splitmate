import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Friendly placeholder for a list or page with nothing in it yet. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon aria-hidden className="size-6" />
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children ? <div className="max-w-md text-sm text-muted-foreground">{children}</div> : null}
      {action}
    </section>
  );
}
