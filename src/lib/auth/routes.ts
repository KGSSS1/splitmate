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
  friends: "/friends",
  groups: "/groups",
  newGroup: "/groups/new",
  invite: "/invite",
  expenses: "/expenses",
  newExpense: "/expenses/new",
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

// Invitation links are public so signed-out visitors can be asked to sign up or
// log in first; accepting still needs a session.
const PUBLIC_PREFIXES = ["/auth/", `${ROUTES.invite}/`];

/** Public pages a visitor may be sent back to after logging in or signing up. */
const RETURNABLE_PUBLIC_PREFIXES = [`${ROUTES.invite}/`];

export function getRouteAccess(pathname: string): RouteAccess {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (GUEST_PATHS.has(path)) return "guest";
  if (PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix))) return "public";
  return "protected";
}

/**
 * Returns `value` if it is a same-origin path that is safe to redirect to after
 * login, otherwise the dashboard. Rejects absolute and protocol-relative URLs
 * (`//evil.example`, `/\evil.example`) and auth endpoints. Invitation links are
 * allowed so a new member lands back on the invitation after signing up.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || value.length > 2048) return ROUTES.dashboard;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return ROUTES.dashboard;
  }
  // Control characters could smuggle a different URL past the checks above.
  if (/[\u0000-\u001f\u007f]/.test(value)) return ROUTES.dashboard;
  const path = value.split(/[?#]/, 1)[0] ?? "";
  if (getRouteAccess(path) === "protected") return value;
  if (RETURNABLE_PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix))) return value;
  return ROUTES.dashboard;
}
