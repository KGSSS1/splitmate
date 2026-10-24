import { Activity, HandCoins, LayoutDashboard, type LucideIcon, Repeat, Settings, UserRound, Users } from "lucide-react";

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
  { href: ROUTES.groups, label: "Groups", icon: Users, available: true },
  { href: ROUTES.friends, label: "Friends", icon: UserRound, available: true },
  { href: ROUTES.activity, label: "Activity", icon: Activity, available: true },
];

/** Secondary pages: the phone menu and the lower part of the sidebar. */
export const SECONDARY_NAV: readonly NavItem[] = [
  { href: ROUTES.settlements, label: "Settlements", icon: HandCoins, available: true },
  { href: ROUTES.recurring, label: "Recurring", icon: Repeat, available: true },
  { href: ROUTES.settings, label: "Settings", icon: Settings, available: true },
];

export const ADD_EXPENSE: Omit<NavItem, "icon"> = {
  href: ROUTES.newExpense,
  label: "Add expense",
  available: true,
};

/** True when `pathname` is `href` or a page below it. */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
