import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Full-width submit button that is disabled and shows a spinner while pending. */
export function SubmitButton({
  pending,
  children,
  className,
}: {
  pending: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Button
      type="submit"
      size="lg"
      disabled={pending}
      aria-busy={pending || undefined}
      className={cn("h-11 w-full md:h-9", className)}
    >
      {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : null}
      {children}
    </Button>
  );
}
