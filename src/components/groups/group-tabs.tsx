"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ROUTES } from "@/lib/auth/routes";
import { cn } from "@/lib/utils";

/** Sections of a group's pages. Expenses and balances join these in M5/M6. */
export function GroupTabs({ groupId }: { groupId: string }) {
  const pathname = usePathname();
  const base = `${ROUTES.groups}/${groupId}`;
  const tabs = [
    { href: base, label: "Members" },
    { href: `${base}/settings`, label: "Settings" },
  ];

  return (
    <nav aria-label="Group sections" className="border-b">
      <ul className="-mb-px flex gap-1">
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium md:min-h-9",
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
