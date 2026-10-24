"use client";

import { LoaderCircle } from "lucide-react";
import { type ReactNode, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const subscribe = () => () => {};

/**
 * Full-width submit button that is disabled and shows a spinner while pending.
 * It is also disabled until hydration: before then the form has no submit
 * handler, and a click would GET the page with the values in the URL.
 */
export function SubmitButton({
  pending,
  disabled = false,
  children,
  className,
}: {
  pending: boolean;
  /** Also disabled while the form can't be saved yet (e.g. an invalid split). */
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  return (
    <Button
      type="submit"
      size="lg"
      disabled={pending || disabled || !hydrated}
      aria-busy={pending || undefined}
      className={cn("h-11 w-full md:h-9", className)}
    >
      {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : null}
      {children}
    </Button>
  );
}
