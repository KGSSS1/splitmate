/**
 * SplitMate's database functions raise SQLSTATEs SM401…SM429 whose messages
 * are written for users (docs/database.md). Everything else — constraint
 * violations, permission errors, network failures — gets a generic message so
 * SQL details never reach the UI (SPEC §8).
 */
export const RPC_ERROR_CODES = ["SM401", "SM403", "SM404", "SM409", "SM422", "SM429"] as const;
export type RpcErrorCode = (typeof RPC_ERROR_CODES)[number];

export const GENERIC_RPC_ERROR = "Something went wrong. Please try again.";
const INVALID_INPUT = "Some of the details aren't valid. Check them and try again.";

export interface RpcErrorLike {
  code?: string | null;
  message?: string | null;
}

export function isRpcErrorCode(code: unknown): code is RpcErrorCode {
  return typeof code === "string" && (RPC_ERROR_CODES as readonly string[]).includes(code);
}

/** The user-facing message and, for SplitMate errors, the SM code. */
export function describeRpcError(error: RpcErrorLike): { message: string; code?: RpcErrorCode } {
  if (isRpcErrorCode(error.code)) {
    const message = error.message?.trim();
    // A message from our own functions is a short sentence; anything else is not trusted.
    if (message && message.length <= 200) {
      return { message: /[.!?]$/.test(message) ? message : `${message}.`, code: error.code };
    }
    return { message: GENERIC_RPC_ERROR, code: error.code };
  }
  if (typeof error.code === "string" && error.code.startsWith("23")) return { message: INVALID_INPUT };
  return { message: GENERIC_RPC_ERROR };
}
