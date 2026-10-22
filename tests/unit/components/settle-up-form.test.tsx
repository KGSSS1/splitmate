import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SettleUpForm } from "@/components/settlements/settle-up-form";

const actions = vi.hoisted(() => ({ createSettlement: vi.fn() }));
vi.mock("@/server/actions/settlements", () => actions);

const BINA = "22222222-2222-4222-8222-222222222222";
const CHETAN = "33333333-3333-4333-8333-333333333333";
const GROUP = "0cf48088-36b1-4e3c-8c33-de8bcb4f62de";
const people = [
  { id: BINA, name: "Bina" },
  { id: CHETAN, name: "Chetan" },
];

const defaults = {
  personId: "",
  direction: "paid" as const,
  amount: "",
  currency: "INR",
  method: "cash" as const,
  upiReference: "",
  note: "",
  settledOn: "2026-10-21",
};

describe("SettleUpForm", () => {
  beforeEach(() => {
    actions.createSettlement.mockReset();
  });

  it("explains what happens next for each direction", async () => {
    const user = userEvent.setup();
    render(
      <SettleUpForm groupId={GROUP} people={people} suggestions={[]} defaultValues={{ ...defaults, personId: BINA }} />,
    );
    expect(screen.getByText("Bina will be asked to confirm it. Balances change once they do.")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Bina paid me"));
    expect(screen.getByText("You're confirming you received it, so balances update right away.")).toBeInTheDocument();
  });

  it("fills person, direction, amount and currency from a suggestion", async () => {
    const user = userEvent.setup();
    render(
      <SettleUpForm
        groupId={GROUP}
        people={people}
        suggestions={[
          { personId: CHETAN, direction: "received", amount: 30000, amountText: "300.00", currency: "INR" },
        ]}
        defaultValues={defaults}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Chetan pays you ₹300.00" }));
    expect(screen.getByLabelText("Settled with")).toHaveValue(CHETAN);
    expect(screen.getByLabelText("Chetan paid me")).toBeChecked();
    expect(screen.getByLabelText("Amount")).toHaveValue("300.00");
  });

  it("shows the UPI reference field only for UPI", async () => {
    const user = userEvent.setup();
    render(<SettleUpForm groupId={null} people={[people[0]!]} suggestions={[]} defaultValues={{ ...defaults, personId: BINA }} />);
    expect(screen.queryByLabelText("UPI reference (optional)")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Paid with"), "upi");
    expect(screen.getByLabelText("UPI reference (optional)")).toBeInTheDocument();
    // A direct settlement has no person picker: it is always the friend.
    expect(screen.queryByLabelText("Settled with")).not.toBeInTheDocument();
  });

  it("validates before sending and reuses one idempotency key across retries", async () => {
    const user = userEvent.setup();
    actions.createSettlement.mockResolvedValue({ ok: false, error: "Something went wrong. Please try again." });
    render(<SettleUpForm groupId={GROUP} people={people} suggestions={[]} defaultValues={defaults} />);

    await user.click(screen.getByRole("button", { name: "Record payment" }));
    expect(await screen.findByText("Choose who you settled up with.")).toBeInTheDocument();
    expect(screen.getByText("Enter an amount.")).toBeInTheDocument();
    expect(actions.createSettlement).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText("Settled with"), BINA);
    await user.type(screen.getByLabelText("Amount"), "100");
    await user.click(screen.getByRole("button", { name: "Record payment" }));
    expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Record payment" }));
    await waitFor(() => expect(actions.createSettlement).toHaveBeenCalledTimes(2));

    const [first] = actions.createSettlement.mock.calls[0]!;
    const [second] = actions.createSettlement.mock.calls[1]!;
    expect(first).toMatchObject({
      groupId: GROUP,
      values: { personId: BINA, direction: "paid", amount: "100", currency: "INR", method: "cash" },
    });
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });
});
