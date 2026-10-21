import { describe, expect, it } from "vitest";

import { GROUP_TYPE_OPTIONS, GROUP_TYPES, isGroupType, toGroupType } from "@/lib/groups/options";

describe("group types", () => {
  it("are trip, home, couple and other (the groups.group_type check)", () => {
    expect(GROUP_TYPES).toEqual(["trip", "home", "couple", "other"]);
    expect(GROUP_TYPE_OPTIONS.map((option) => option.label)).toEqual(["Trip", "Home", "Couple", "Other"]);
  });

  it("falls back to other for unexpected values", () => {
    expect(isGroupType("trip")).toBe(true);
    expect(isGroupType("party")).toBe(false);
    expect(toGroupType("party")).toBe("other");
    expect(toGroupType(null)).toBe("other");
  });
});
