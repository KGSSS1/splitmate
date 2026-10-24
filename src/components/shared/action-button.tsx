"use client";

import { LoaderCircle } from "lucide-react";
import { type ReactNode, useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/server/action-result";

const NETWORK_ERROR = "Couldn't reach the server. Check your connection and try again.";

type Variant = "default" | "outline" | "secondary" | "ghost" | "destructive";

/**
 * A button that runs one bound Server Action, stays disabled while it runs and
 * shows the server's error next to it. With `confirm`, the first click asks
 * for confirmation inline (no modal) before anything is sent.
 */
export function ActionButton({
  action,
  children,
  confirm,
  confirmLabel = "Confirm",
  variant = "outline",
  className,
}: {
  action: () => Promise<ActionResult>;
  children: ReactNode;
  confirm?: string;
  confirmLabel?: string;
  variant?: Variant;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  function run() {
    setError(null);
    startTransition(async () => {
      let result: ActionResult;
      try {
        result = await action();
      } catch {
        result = { ok: false, error: NETWORK_ERROR };
      }
      // A redirecting action resolves without a result. Wrapped again so the
      // error and the re-enabled button commit together (review M17).
      startTransition(() => {
        if (result && !result.ok) setError(result.error);
        setConfirming(false);
      });
    });
  }

  const buttonClass = cn("h-11 md:h-8", className);

  return (
    <div className="grid justify-items-start gap-2">
      {confirming ? (
        <div role="group" aria-label={confirm} className="grid gap-2">
          <p className="text-sm">{confirm}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={variant === "destructive" ? "destructive" : "default"}
              className={buttonClass}
              disabled={pending}
              aria-busy={pending || undefined}
              onClick={run}
            >
              {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : null}
              {confirmLabel}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={buttonClass}
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant={variant}
          className={buttonClass}
          disabled={pending}
          aria-busy={pending || undefined}
          aria-describedby={error ? errorId : undefined}
          onClick={() => (confirm ? setConfirming(true) : run())}
        >
          {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : null}
          {children}
        </Button>
      )}
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
