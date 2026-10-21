import { Heart, House, type LucideIcon, Plane, Users } from "lucide-react";

import type { GroupType } from "@/lib/groups/options";
import { cn } from "@/lib/utils";

const ICONS: Record<GroupType, LucideIcon> = {
  trip: Plane,
  home: House,
  couple: Heart,
  other: Users,
};

/** Decorative icon for a group type; the type is always also given as text. */
export function GroupTypeIcon({ type, className }: { type: GroupType; className?: string }) {
  const Icon = ICONS[type];
  return (
    <span
      className={cn("flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary", className)}
    >
      <Icon aria-hidden className="size-5" />
    </span>
  );
}
