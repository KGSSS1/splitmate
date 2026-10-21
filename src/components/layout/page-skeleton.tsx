import { Skeleton } from "@/components/ui/skeleton";

/** Generic page placeholder: a heading and a few cards. */
export function PageSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading">
      <div className="grid gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-48" />
    </div>
  );
}
