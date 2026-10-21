import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "@/app/page";
import { brand } from "@/config/brand";

describe("Home page", () => {
  it("shows the brand name and tagline", () => {
    render(<Home />);

    expect(screen.getByRole("heading", { level: 1, name: brand.name })).toBeInTheDocument();
    expect(screen.getByText(brand.tagline)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: brand.logo.alt })).toBeInTheDocument();
  });
});
