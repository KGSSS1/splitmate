import { Skeleton } from "@/components/ui/skeleton";
import { getProfile } from "@/server/auth";

/** Initials avatar + name + email of the signed-in user (reads the session). */
export async function AccountSummary() {
  const profile = await getProfile();
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary-emphasis"
      >
        {initials(profile.display_name)}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{profile.display_name}</p>
        {profile.email ? <p className="truncate text-xs text-muted-foreground">{profile.email}</p> : null}
      </div>
    </div>
  );
}

export function AccountSummarySkeleton() {
  return (
    <div className="flex items-center gap-3" aria-hidden>
      <Skeleton className="size-9 rounded-full" />
      <div className="grid flex-1 gap-1.5">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-3 w-32" />
      </div>
    </div>
  );
}

function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => [...part][0] ?? "")
    .join("");
  return letters.toUpperCase() || "?";
}
