"use client";

import { ChevronDown } from "lucide-react";
import { type ComponentProps, useId } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { FieldError } from "./text-field";

type NativeSelectProps = ComponentProps<"select"> & {
  label: string;
  error?: string;
  hint?: string;
  options: readonly { value: string; label: string }[];
};

/**
 * Labelled native <select>: long lists (currencies, time zones) stay usable on
 * phones, where the OS picker takes over.
 */
export function NativeSelect({ id, label, error, hint, options, className, ...props }: NativeSelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const hintId = `${selectId}-hint`;
  const errorId = `${selectId}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="grid gap-2">
      <Label htmlFor={selectId}>{label}</Label>
      <div className="relative">
        <select
          id={selectId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "h-11 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent py-1 pr-9 pl-2.5 text-base outline-none md:h-9 md:text-sm dark:bg-input/30",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
            className,
          )}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
      </div>
      {hint && !error ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <FieldError id={errorId} message={error} />
    </div>
  );
}
