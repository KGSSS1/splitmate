import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { ROUTES } from "@/lib/auth/routes";
import { GROUP_TYPE_LABELS } from "@/lib/groups/options";
import type { GroupSettings } from "@/server/groups";

import { GroupTabs } from "./group-tabs";
import { GroupTypeIcon } from "./group-type-icon";

/** Back link, name, type and settings summary, and (for members) the tab bar. */
export function GroupHeader({ group, showTabs = true }: { group: GroupSettings; showTabs?: boolean }) {
  return (
    <div className="grid gap-4">
      <Link
        href={ROUTES.groups}
        className="inline-flex min-h-11 items-center gap-1 justify-self-start text-sm text-muted-foreground hover:text-foreground md:min-h-0"
      >
        <ArrowLeft aria-hidden className="size-4" />
        All groups
      </Link>
      <header className="flex items-start gap-3">
        <GroupTypeIcon type={group.groupType} className="size-12" />
        <div className="grid min-w-0 gap-1">
          <h1 className="text-2xl font-semibold tracking-tight break-words md:text-3xl">{group.name}</h1>
          <p className="text-sm text-muted-foreground">
            {GROUP_TYPE_LABELS[group.groupType]} · {group.defaultCurrency} ·{" "}
            {group.simplifyDebts ? "Debts simplified" : "Debts not simplified"}
          </p>
          {group.description ? <p className="text-sm">{group.description}</p> : null}
        </div>
      </header>
      {showTabs ? <GroupTabs groupId={group.id} /> : null}
    </div>
  );
}
