"use client";

import { useState, useTransition } from "react";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

import type { ActionResult } from "@/server/action-result";

const NETWORK_ERROR = "Couldn't reach the server. Check your connection and try again.";

/**
 * Runs a Server Action from a React Hook Form submit handler: tracks pending
 * state, keeps the last result for <FormStatus>, and maps server field errors
 * back onto the form. Redirecting actions simply navigate away.
 */
export function useActionSubmit<TFieldValues extends FieldValues, TSubmit>(
  action: (values: TSubmit) => Promise<ActionResult<unknown>>,
  setError: UseFormSetError<TFieldValues>,
) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);

  function submit(values: TSubmit) {
    setResult(null);
    startTransition(async () => {
      let next: ActionResult<unknown>;
      try {
        next = await action(values);
      } catch {
        next = { ok: false, error: NETWORK_ERROR };
      }
      // A redirecting action resolves without a result.
      if (!next) return;
      // Updates after an await aren't part of the transition unless wrapped
      // again; otherwise the result can render while `pending` (the disabled
      // button) is still true (review M17).
      const result = next;
      startTransition(() => {
        setResult(result);
        if (!result.ok && result.fieldErrors) {
          for (const [name, message] of Object.entries(result.fieldErrors)) {
            setError(name as Path<TFieldValues>, { type: "server", message });
          }
        }
      });
    });
  }

  return {
    pending,
    submit,
    error: result && !result.ok ? result.error : null,
    errorCode: result && !result.ok ? (result.code ?? null) : null,
    success: result?.ok ? (result.message ?? null) : null,
  };
}
