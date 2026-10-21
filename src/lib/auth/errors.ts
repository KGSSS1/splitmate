/**
 * User-facing messages for Supabase Auth error codes. Unknown codes get a
 * generic message so raw server errors never reach the UI (SPEC §8).
 */
const MESSAGES: Record<string, string> = {
  invalid_credentials: "Incorrect email or password.",
  email_not_confirmed: "Confirm your email address first. Check your inbox for the link.",
  weak_password: "Choose a stronger password: at least 8 characters, not a common one.",
  same_password: "Your new password must be different from the current one.",
  reauthentication_needed: "For security, log in again before changing your password.",
  over_request_rate_limit: "Too many attempts. Wait a minute and try again.",
  over_email_send_rate_limit: "Too many emails sent. Wait a few minutes and try again.",
  signup_disabled: "Sign-ups are currently closed.",
  email_address_invalid: "Enter a valid email address.",
  user_banned: "This account is disabled.",
  session_not_found: "Your session has ended. Log in again.",
  otp_expired: "This link has expired or was already used. Request a new one.",
};

export const GENERIC_AUTH_ERROR = "Something went wrong. Please try again.";

export function authErrorMessage(code: string | undefined): string {
  // Own keys only: "constructor" and friends must not resolve to Object.prototype.
  return code && Object.hasOwn(MESSAGES, code) ? (MESSAGES[code] ?? GENERIC_AUTH_ERROR) : GENERIC_AUTH_ERROR;
}
