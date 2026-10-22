"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ROUTES } from "@/lib/auth/routes";
import { cn } from "@/lib/utils";

/** Sections of a group's pages. */
export function GroupTabs({ groupId }: { groupId: string }) {
  const pathname = usePathname();
  const base = `${ROUTES.groups}/${groupId}`;
  const tabs = [
    { href: base, label: "Expenses" },
    { href: `${base}/balances`, label: "Balances" },
    { href: `${base}/members`, label: "Members" },
    { href: `${base}/settings`, label: "Settings" },
  ];

  return (
    // Scrolls sideways on narrow phones; the inset shadow is the bottom rule the active tab sits on.
    <nav aria-label="Group sections" className="overflow-x-auto">
      <ul className="flex min-w-max gap-1 shadow-[inset_0_-1px_0_var(--border)]">
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center border-b-2 px-2.5 text-sm font-medium md:min-h-9 md:px-3",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
