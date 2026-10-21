import type { z } from "zod";

/**
 * What a Server Action returns when it does not redirect. Messages are safe to
 * show to users; raw database or auth errors never go in here.
 */
export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string> };

export function invalidInput(error: z.ZodError): ActionResult {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "form";
    fieldErrors[key] ??= issue.message;
  }
  return { ok: false, error: "Check the highlighted fields.", fieldErrors };
}
