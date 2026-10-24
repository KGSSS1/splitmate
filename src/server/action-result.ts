import type { z } from "zod";

import { describeRpcError, type RpcErrorLike } from "@/lib/db/rpc-error";

/**
 * What a Server Action returns when it does not redirect. Messages are safe to
 * show to users; raw database or auth errors never go in here. `data` carries
 * a result the page needs (for example a new invitation link).
 */
export type ActionResult<TData = undefined> =
  | { ok: true; message?: string; data?: TData }
  | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string> };

export function invalidInput(error: z.ZodError): ActionResult<never> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "form";
    fieldErrors[key] ??= issue.message;
  }
  return { ok: false, error: "Check the highlighted fields.", fieldErrors };
}

/** A failed RPC as a user-safe result (SM-coded messages pass through; anything else is generic). */
export function rpcFailure(error: RpcErrorLike): ActionResult<never> {
  const { message, code } = describeRpcError(error);
  return code ? { ok: false, error: message, code } : { ok: false, error: message };
}
