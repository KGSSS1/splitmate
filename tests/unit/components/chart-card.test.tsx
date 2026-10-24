import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";

import { ChartCard } from "@/components/analytics/chart-card";

beforeAll(() => {
  // jsdom has no layout; Recharts' responsive sizing needs these to exist.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const TABLE = {
  caption: "Your spending by category",
  columns: ["Category", "Your share"],
  rows: [
    { key: "rent", cells: ["Rent", "₹10,000.00"] },
    { key: "food", cells: ["Food and drink", "₹800.00"] },
  ],
  total: ["Total", "₹10,800.00"],
};

function renderCard(values = [1000000, 80000]) {
  return render(
    <ChartCard
      title="Spending by category"
      description="Your share."
      summary="₹10,800.00 in total; the largest is Rent."
      currency="INR"
      layout="bars"
      data={[
        { key: "rent", label: "Rent", value: values[0] ?? 0 },
        { key: "food", label: "Food and drink", value: values[1] ?? 0 },
      ]}
      table={TABLE}
    />,
  );
}

describe("ChartCard", () => {
  it("has a summary for screen readers and switches to its table view", async () => {
    const user = userEvent.setup();
    const { container } = renderCard();
    expect(screen.getByRole("heading", { name: "Spending by category" })).toBeInTheDocument();
    // Once as the figure's caption, once as the SVG's <desc>.
    expect(container.querySelector("figcaption")).toHaveTextContent("₹10,800.00 in total; the largest is Rent.");
    expect(container.querySelector("svg desc")).toHaveTextContent("₹10,800.00 in total; the largest is Rent.");
    const table = container.querySelector("[data-table]");
    expect(table).toHaveClass("hidden");
    // Printing always shows the table and hides the chart.
    expect(table).toHaveClass("print:block");
    expect(container.querySelector("[data-chart]")).toHaveClass("print:hidden");

    await user.click(screen.getByRole("button", { name: "Table" }));
    expect(screen.getByRole("button", { name: "Table" })).toHaveAttribute("aria-pressed", "true");
    expect(table).not.toHaveClass("hidden");
    expect(container.querySelector("[data-chart]")).toHaveClass("hidden");
    const grid = screen.getByRole("table", { name: "Your spending by category" });
    expect(grid).toHaveTextContent("Rent₹10,000.00");
    expect(screen.getByRole("rowheader", { name: "Total" })).toBeInTheDocument();
  });

  it("says when there is nothing to chart instead of drawing empty axes", () => {
    renderCard([0, 0]);
    expect(screen.getByText("Nothing in this period.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Table" })).toBeNull();
  });
});
