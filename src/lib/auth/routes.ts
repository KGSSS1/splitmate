/** App routes used by auth redirects. Pure: shared by src/proxy.ts and the server. */
export const ROUTES = {
  home: "/",
  login: "/login",
  signup: "/signup",
  checkEmail: "/check-email",
  resetPassword: "/reset-password",
  updatePassword: "/reset-password/update",
  authConfirm: "/auth/confirm",
  onboarding: "/onboarding",
  dashboard: "/dashboard",
  settings: "/settings",
} as const;

/**
 * - `guest`: only for signed-out visitors; signed-in users go to the dashboard.
 * - `public`: anyone (email-link handlers).
 * - `protected`: needs a session; everything not listed is protected by default.
 */
export type RouteAccess = "guest" | "public" | "protected";

const GUEST_PATHS = new Set<string>([
  ROUTES.home,
  ROUTES.login,
  ROUTES.signup,
  ROUTES.checkEmail,
  ROUTES.resetPassword,
]);

const PUBLIC_PREFIXES = ["/auth/"];

export function getRouteAccess(pathname: string): RouteAccess {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (GUEST_PATHS.has(path)) return "guest";
  if (PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix))) return "public";
  return "protected";
}

/**
 * Returns `value` if it is a same-origin path that is safe to redirect to after
 * login, otherwise the dashboard. Rejects absolute and protocol-relative URLs
 * (`//evil.example`, `/\evil.example`) and auth endpoints.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || value.length > 2048) return ROUTES.dashboard;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return ROUTES.dashboard;
  }
  // Control characters could smuggle a different URL past the checks above.
  if (/[\u0000-\u001f\u007f]/.test(value)) return ROUTES.dashboard;
  const path = value.split(/[?#]/, 1)[0] ?? "";
  if (getRouteAccess(path) !== "protected") return ROUTES.dashboard;
  return value;
}
