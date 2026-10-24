/** Group types (SPEC §2): stored in `groups.group_type`. */
export const GROUP_TYPES = ["trip", "home", "couple", "other"] as const;
export type GroupType = (typeof GROUP_TYPES)[number];

export const GROUP_TYPE_LABELS: Record<GroupType, string> = {
  trip: "Trip",
  home: "Home",
  couple: "Couple",
  other: "Other",
};

export const GROUP_TYPE_OPTIONS: readonly { value: GroupType; label: string }[] = GROUP_TYPES.map((value) => ({
  value,
  label: GROUP_TYPE_LABELS[value],
}));

export function isGroupType(value: unknown): value is GroupType {
  return typeof value === "string" && (GROUP_TYPES as readonly string[]).includes(value);
}

/** A stored group type, or "other" for anything unexpected. */
export function toGroupType(value: string | null | undefined): GroupType {
  return isGroupType(value) ? value : "other";
}

/** How long a new invitation stays valid (SQL allows 1–720 hours). */
export const INVITE_EXPIRY_DAYS = [1, 7, 30] as const;
export const DEFAULT_INVITE_EXPIRY_DAYS = 7;
/** Uses allowed for a shareable link (SQL allows 1–100). Email invitations are single-use. */
export const DEFAULT_LINK_MAX_USES = 10;
