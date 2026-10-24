import type { SettlementStatus } from "@/lib/accounting/types";
import { cn } from "@/lib/utils";

const STYLES: Record<SettlementStatus, string> = {
  pending: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  completed: "bg-primary/10 text-primary-emphasis",
  rejected: "bg-destructive/10 text-destructive-emphasis",
  withdrawn: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
};

const LABELS: Record<SettlementStatus, string> = {
  pending: "Pending",
  completed: "Completed",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  cancelled: "Cancelled",
};

/** The status as a word (never colour alone, SPEC §9). */
export function SettlementStatusBadge({ status, className }: { status: SettlementStatus; className?: string }) {
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", STYLES[status], className)}>
      {LABELS[status]}
    </span>
  );
}
