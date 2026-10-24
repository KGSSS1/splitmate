import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SubmitButton } from "@/components/forms/submit-button";

describe("SubmitButton", () => {
  // Before hydration the forms have no submit handler, so a click would make the
  // browser GET the page with the form's values in the URL and save nothing.
  it("is disabled in the server HTML, before hydration", () => {
    const html = renderToString(<SubmitButton pending={false}>Save changes</SubmitButton>);
    expect(html).toMatch(/<button[^>]* disabled=""/);
  });

  it("is enabled once hydrated, and disabled while pending", () => {
    const { rerender } = render(<SubmitButton pending={false}>Save changes</SubmitButton>);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
    rerender(<SubmitButton pending>Save changes</SubmitButton>);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });
});
