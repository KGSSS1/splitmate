"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ADD_EXPENSE, isActivePath, type NavItem, PRIMARY_NAV, SECONDARY_NAV } from "./nav-config";

/** Desktop sidebar navigation: primary pages, then secondary ones. */
export function SidebarNav() {
  return (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-6">
      <ul className="grid gap-1">
        {PRIMARY_NAV.map((item) => (
          <li key={item.href}>
            <SidebarNavLink item={item} />
          </li>
        ))}
      </ul>
      <ul className="mt-auto grid gap-1">
        {SECONDARY_NAV.map((item) => (
          <li key={item.href}>
            <SidebarNavLink item={item} />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SidebarNavLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const Icon = item.icon;
  const base = "flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium";

  if (!item.available) {
    return (
      <span aria-disabled="true" className={cn(base, "cursor-not-allowed text-muted-foreground/70")}>
        <Icon aria-hidden className="size-4" />
        {item.label}
        <SoonBadge />
      </span>
    );
  }

  const active = isActivePath(pathname, item.href);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        base,
        "transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/80",
      )}
    >
      <Icon aria-hidden className={cn("size-4", active && "text-primary")} />
      {item.label}
    </Link>
  );
}

/**
 * Phone bottom bar: two tabs, the Add Expense button, two tabs. Padded by the
 * bottom safe-area inset so it clears the home indicator.
 */
export function BottomNav() {
  const [first, second, third, fourth] = PRIMARY_NAV;
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="mx-auto flex max-w-lg items-stretch px-2">
        {[first, second].map((item) => item && <BottomNavLink key={item.href} item={item} />)}
        <li className="flex flex-1 items-center justify-center">
          <AddExpenseButton variant="fab" />
        </li>
        {[third, fourth].map((item) => item && <BottomNavLink key={item.href} item={item} />)}
      </ul>
    </nav>
  );
}

function BottomNavLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const Icon = item.icon;
  const base = "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.7rem] font-medium";

  if (!item.available) {
    return (
      <li className="flex flex-1">
        <span aria-disabled="true" className={cn(base, "w-full text-muted-foreground/60")}>
          <Icon aria-hidden className="size-5" />
          {item.label}
          <span className="sr-only">(coming soon)</span>
        </span>
      </li>
    );
  }

  const active = isActivePath(pathname, item.href);
  return (
    <li className="flex flex-1">
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(base, "w-full", active ? "text-primary" : "text-muted-foreground hover:text-foreground")}
      >
        <Icon aria-hidden className="size-5" />
        {item.label}
      </Link>
    </li>
  );
}

/** The prominent Add Expense action: a round button on phones, full width in the sidebar. */
export function AddExpenseButton({ variant }: { variant: "fab" | "sidebar" }) {
  const fab = variant === "fab";
  const className = fab
    ? "size-14 -translate-y-3 rounded-full shadow-lg [&_svg:not([class*='size-'])]:size-6"
    : "h-10 w-full justify-start gap-2 px-3";

  if (!ADD_EXPENSE.available) {
    return (
      <Button disabled aria-label={`${ADD_EXPENSE.label} (coming soon)`} className={className} title="Coming soon">
        <Plus aria-hidden />
        {fab ? null : ADD_EXPENSE.label}
      </Button>
    );
  }

  return (
    <Link
      href={ADD_EXPENSE.href}
      aria-label={fab ? ADD_EXPENSE.label : undefined}
      className={cn(buttonVariants(), className)}
    >
      <Plus aria-hidden />
      {fab ? null : ADD_EXPENSE.label}
    </Link>
  );
}

function SoonBadge() {
  return (
    <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
      Soon
    </span>
  );
}
