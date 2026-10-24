import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RedirectNotice } from "@/components/forms/redirect-notice";

describe("RedirectNotice", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  // Review L17: the banner came from `?saved=`, so it stayed after any later
  // action on the page (which refreshes the same URL).
  it("shows the message and drops its parameter at the next interaction", () => {
    window.history.replaceState(null, "", "/expenses/abc?saved=created&tab=history#comments");
    render(<RedirectNotice param="saved" message="Expense saved. Balances are updated." />);
    expect(screen.getByRole("status")).toHaveTextContent("Expense saved. Balances are updated.");
    expect(window.location.search).toBe("?saved=created&tab=history");
    fireEvent.pointerDown(document.body);
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      "/expenses/abc?tab=history#comments",
    );
  });
});
