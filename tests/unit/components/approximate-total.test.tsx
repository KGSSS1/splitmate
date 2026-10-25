import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ApproximateTotalCard } from "@/components/dashboard/approximate-total";

describe("ApproximateTotalCard", () => {
  it("labels the converted total as approximate, with its source and what it left out", () => {
    render(
      <ApproximateTotalCard
        total={{
          currency: "INR",
          owedToYou: 144945,
          youOwe: 120000,
          net: 24945,
          included: ["INR", "USD"],
          missing: ["AED"],
          rateDate: "2026-10-23",
          provider: "frankfurter",
        }}
      />,
    );
    const card = screen.getByRole("region", { name: "Approximate total in INR" });
    expect(card).toHaveTextContent("≈ +₹249.45 net");
    expect(card).toHaveTextContent("≈ ₹1,449.45 owed to you, ≈ ₹1,200.00 you owe");
    expect(card).toHaveTextContent("For information only");
    expect(card).toHaveTextContent("converted at Frankfurter's ECB reference rates from 23 Oct 2026.");
    expect(card).toHaveTextContent("Balances stay in their own currencies");
    expect(card).toHaveTextContent("Not included (no rate): AED.");
  });

  it("says plainly when no rates are stored, without hiding the exact balances", () => {
    render(<ApproximateTotalCard total={null} />);
    expect(screen.getByText(/isn't available right now \(no exchange rates yet\)/)).toBeInTheDocument();
    expect(screen.queryByRole("region")).toBeNull();
  });
});
