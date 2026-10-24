import { RECURRING_STATUS_LABELS, type RecurringStatus } from "@/lib/recurring/schedule";
import { cn } from "@/lib/utils";

const STYLES: Record<RecurringStatus, string> = {
  active: "bg-primary/10 text-primary-emphasis",
  paused: "bg-muted text-foreground",
  ended: "bg-muted text-muted-foreground",
  cancelled: "bg-destructive/10 text-destructive-emphasis",
};

/** The template's state in words (never colour alone). */
export function RecurringStatusBadge({ status }: { status: RecurringStatus }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STYLES[status])}>
      {RECURRING_STATUS_LABELS[status]}
    </span>
  );
}
