import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BottomNav, SidebarNav } from "@/components/layout/app-nav";

vi.mock("next/navigation", () => ({ usePathname: () => "/groups/abc" }));

// Review L19: the current page was marked by colour alone.
describe("navigation", () => {
  it.each([
    ["sidebar", SidebarNav],
    ["bottom bar", BottomNav],
  ])("the %s marks the current page with an indicator, not just colour", (_name, Nav) => {
    render(<Nav />);
    const current = screen.getByRole("link", { current: "page" });
    expect(current).toHaveTextContent("Groups");
    expect(current.querySelector("[data-active-indicator]")).not.toBeNull();
    for (const link of screen.getAllByRole("link").filter((element) => element !== current)) {
      expect(link.querySelector("[data-active-indicator]")).toBeNull();
    }
  });
});
