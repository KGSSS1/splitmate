import { Activity, LayoutDashboard, type LucideIcon, Settings, UserRound, Users } from "lucide-react";

import { ROUTES } from "@/lib/auth/routes";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * False while the page does not exist yet: the item renders as a disabled
   * "Soon" entry instead of linking to a 404. Flip it in the milestone that
   * builds the page (IMPLEMENTATION_PLAN.md).
   */
  available: boolean;
}

/** Bottom navigation on phones, main section of the sidebar on desktop (SPEC §9). */
export const PRIMARY_NAV: readonly NavItem[] = [
  { href: ROUTES.dashboard, label: "Dashboard", icon: LayoutDashboard, available: true },
  { href: "/groups", label: "Groups", icon: Users, available: false }, // M4
  { href: "/friends", label: "Friends", icon: UserRound, available: false }, // M4
  { href: "/activity", label: "Activity", icon: Activity, available: false }, // M6
];

/** Secondary pages: the phone menu and the lower part of the sidebar. */
export const SECONDARY_NAV: readonly NavItem[] = [
  { href: ROUTES.settings, label: "Settings", icon: Settings, available: true },
];

export const ADD_EXPENSE: Omit<NavItem, "icon"> = {
  href: "/expenses/new",
  label: "Add expense",
  available: false, // M5
};

/** True when `pathname` is `href` or a page below it. */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
