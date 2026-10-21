import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder with the shape of a short auth form, shown while it loads. */
export function AuthFormSkeleton({ fields = 2 }: { fields?: number }) {
  return (
    <div className="grid gap-4" aria-hidden>
      {Array.from({ length: fields }, (_, index) => (
        <div key={index} className="grid gap-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-11 w-full md:h-9" />
        </div>
      ))}
      <Skeleton className="h-11 w-full md:h-9" />
    </div>
  );
}
