import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExpenseForm, type ExpenseFormMode } from "@/components/expenses/expense-form";
import { blankExpenseValues } from "@/lib/expenses/form-values";

const actions = vi.hoisted(() => ({ createExpense: vi.fn(), updateExpense: vi.fn() }));
vi.mock("@/server/actions/expenses", () => actions);
const recurringActions = vi.hoisted(() => ({ createRecurringExpense: vi.fn(), updateRecurringExpense: vi.fn() }));
vi.mock("@/server/actions/recurring", () => recurringActions);

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const GROUP = "00000000-0000-4000-8000-0000000000f1";

const options = {
  me: { id: A, name: "Asha" },
  groups: [
    {
      id: GROUP,
      name: "Goa trip",
      defaultCurrency: "INR",
      members: [
        { id: A, name: "Asha" },
        { id: B, name: "Bina" },
        { id: C, name: "Chetan" },
      ],
    },
  ],
  friends: [{ id: B, name: "Bina" }],
};

function renderForm(mode: ExpenseFormMode = { kind: "create" }) {
  const user = userEvent.setup();
  render(
    <ExpenseForm
      options={options}
      mode={mode}
      defaultValues={blankExpenseValues({
        splitWith: `group:${GROUP}`,
        userIds: [A, B, C],
        paidBy: A,
        currency: "INR",
        date: "2026-10-21",
      })}
    />,
  );
  return user;
}

const save = () => screen.getByRole("button", { name: "Save expense" });
const preview = () => within(screen.getByRole("region", { name: "Preview" }));

describe("ExpenseForm", () => {
  beforeEach(() => {
    actions.createExpense.mockReset();
    actions.updateExpense.mockReset();
    recurringActions.createRecurringExpense.mockReset();
    recurringActions.updateRecurringExpense.mockReset();
  });

  it("blocks saving until the split is valid, then previews each share", async () => {
    const user = renderForm();
    expect(save()).toBeDisabled();
    expect(preview().getByText("Enter an amount.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Amount"), "900");
    expect(save()).toBeEnabled();
    const shares = preview().getByRole("list", { name: "Shares" });
    expect(within(shares).getAllByText("₹300.00")).toHaveLength(3);
    expect(preview().getByText("Bina owes Asha (you) ₹300.00")).toBeInTheDocument();
  });

  it("marks who received a rounding unit", async () => {
    const user = renderForm();
    await user.type(screen.getByLabelText("Amount"), "100");
    const rows = within(preview().getByRole("list", { name: "Shares" })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Asha (you)+1 rounding unit₹33.34");
    expect(rows[1]).toHaveTextContent("Bina₹33.33");
    expect(rows[1]).not.toHaveTextContent("rounding unit");
  });

  it("excluded people get no share", async () => {
    const user = renderForm();
    await user.type(screen.getByLabelText("Amount"), "900");
    await user.click(screen.getByRole("checkbox", { name: "Include Chetan" }));
    const shares = within(preview().getByRole("list", { name: "Shares" }));
    expect(shares.getAllByText("₹450.00")).toHaveLength(2);
    expect(shares.queryByText("Chetan")).not.toBeInTheDocument();
  });

  it("percentages must add up to 100% before saving", async () => {
    const user = renderForm();
    await user.type(screen.getByLabelText("Amount"), "900");
    await user.click(screen.getByRole("radio", { name: "Percentages" }));
    await user.type(screen.getByLabelText("Asha's percentage"), "50");
    await user.type(screen.getByLabelText("Bina's percentage"), "40");
    expect(save()).toBeDisabled();
    expect(screen.getAllByText("The percentages add up to 90%. 10% is left.").length).toBeGreaterThan(0);

    await user.type(screen.getByLabelText("Chetan's percentage"), "10");
    expect(save()).toBeEnabled();
    expect(preview().getByText("₹90.00")).toBeInTheDocument();
  });

  it("exact amounts say how much is left, and point at a bad value", async () => {
    const user = renderForm();
    await user.type(screen.getByLabelText("Amount"), "900");
    await user.click(screen.getByRole("radio", { name: "Exact amounts" }));
    await user.type(screen.getByLabelText("Asha's share"), "500");
    expect(screen.getAllByText("The amounts add up to ₹500.00. ₹400.00 is left to assign.").length).toBeGreaterThan(0);

    await user.type(screen.getByLabelText("Bina's share"), "4.001");
    expect(screen.getByLabelText("Bina's share")).toHaveAttribute("aria-invalid", "true");
    expect(save()).toBeDisabled();
  });

  it("shares split by whole-number weights", async () => {
    const user = renderForm();
    await user.type(screen.getByLabelText("Amount"), "900");
    await user.click(screen.getByRole("radio", { name: "Shares" }));
    await user.clear(screen.getByLabelText("Asha's shares"));
    await user.type(screen.getByLabelText("Asha's shares"), "2");
    expect(preview().getByText("₹450.00")).toBeInTheDocument();
    expect(preview().getAllByText("₹225.00")).toHaveLength(2);
  });

  it("several payers must add up to the total", async () => {
    const user = renderForm();
    await user.type(screen.getByLabelText("Amount"), "900");
    await user.selectOptions(screen.getByLabelText("Paid by"), "More than one person");
    await user.type(screen.getByLabelText("Amount Asha paid"), "600");
    expect(save()).toBeDisabled();
    expect(screen.getAllByText("The payments add up to ₹600.00. ₹300.00 is still unpaid.").length).toBeGreaterThan(0);

    await user.type(screen.getByLabelText("Amount Bina paid"), "300");
    expect(save()).toBeEnabled();
    expect(preview().getByText("Chetan owes Asha (you) ₹300.00")).toBeInTheDocument();
  });

  it("itemized bills total the items, tax and tip", async () => {
    const user = renderForm();
    await user.click(screen.getByRole("radio", { name: "By item" }));
    await user.click(screen.getByRole("button", { name: "Add item" }));
    await user.type(screen.getByLabelText("Item 1"), "Pizza");
    await user.type(screen.getByLabelText("Item 1 amount"), "600");
    await user.click(screen.getByRole("checkbox", { name: "Chetan shares item 1" }));
    await user.click(screen.getByRole("button", { name: "Add tax, tip or discount" }));
    await user.type(screen.getByLabelText("Line 1 amount"), "60");

    expect(save()).toBeEnabled();
    expect(preview().getByText("₹660.00")).toBeInTheDocument();
    expect(preview().getAllByText("₹330.00")).toHaveLength(2);
  });

  // Review L22 / L28: a visible "Shares" label, and one short live summary instead
  // of re-announcing the whole preview on every keystroke.
  it("labels the shares and announces only a one-line summary", async () => {
    const user = renderForm();
    const region = screen.getByRole("region", { name: "Preview" });
    expect(region).not.toHaveAttribute("aria-live");
    await user.type(screen.getByLabelText("Amount"), "900");
    expect(preview().getByRole("heading", { name: "Shares" })).toBeVisible();
    const live = region.querySelectorAll("[aria-live]");
    expect(live).toHaveLength(1);
    expect(live[0]).toHaveTextContent(/^Total ₹900\.00, split between 3 people\.$/);
    expect(region.querySelector('[role="status"], [role="alert"]')).toBeNull();
  });

  // Review L32: "0.00" is the wrong hint for currencies with 0 or 3 decimals.
  it("shows an amount placeholder with the currency's decimals", async () => {
    const user = renderForm();
    expect(screen.getByLabelText("Amount")).toHaveAttribute("placeholder", "0.00");
    await user.selectOptions(screen.getByLabelText("Currency"), "JPY");
    expect(screen.getByLabelText("Amount")).toHaveAttribute("placeholder", "0");
    await user.selectOptions(screen.getByLabelText("Currency"), "KWD");
    expect(screen.getByLabelText("Amount")).toHaveAttribute("placeholder", "0.000");
  });

  // Review L19: the chosen split method was shown by colour alone.
  it("marks the chosen split method with a check, not just colour", async () => {
    const user = renderForm();
    const pill = (name: string) => screen.getByRole("radio", { name }).closest("label");
    expect(pill("Equally")?.querySelector("[data-checked-indicator]")).not.toBeNull();
    await user.click(screen.getByRole("radio", { name: "By item" }));
    expect(pill("By item")?.querySelector("[data-checked-indicator]")).not.toBeNull();
    expect(pill("Equally")?.querySelector("[data-checked-indicator]")).toBeNull();
  });

  it("checks the description on submit and sends nothing until it is fixed", async () => {
    const user = renderForm();
    await user.type(screen.getByLabelText("Amount"), "900");
    await user.click(save());
    expect(await screen.findByText("Describe the expense.")).toBeInTheDocument();
    expect(actions.createExpense).not.toHaveBeenCalled();
  });

  it("submits what was typed with one idempotency key, reused when retrying", async () => {
    actions.createExpense.mockResolvedValue({ ok: false, error: "Couldn't reach the server." });
    const user = renderForm();
    await user.type(screen.getByLabelText("Description"), "Dinner");
    await user.type(screen.getByLabelText("Amount"), "900");
    await user.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach the server.");
    // Retry only once Save is usable again (review M17).
    await vi.waitFor(() => expect(save()).toBeEnabled());
    await user.click(save());

    await vi.waitFor(() => expect(actions.createExpense).toHaveBeenCalledTimes(2));
    const [first] = actions.createExpense.mock.calls[0] ?? [];
    const [second] = actions.createExpense.mock.calls[1] ?? [];
    expect(first.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    // Strings as typed: the server resolves the amounts again itself.
    expect(first.values).toMatchObject({ description: "Dinner", amount: "900", splitWith: `group:${GROUP}` });
  });

  it("edits send the expected version", async () => {
    actions.updateExpense.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <ExpenseForm
        options={options}
        mode={{ kind: "edit", expenseId: GROUP, expectedVersion: 3 }}
        defaultValues={{
          ...blankExpenseValues({ splitWith: `group:${GROUP}`, userIds: [A, B, C], paidBy: A, currency: "INR", date: "2026-10-21" }),
          description: "Dinner",
          amount: "900",
        }}
      />,
    );
    expect(screen.getByLabelText("Split with")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await vi.waitFor(() =>
      expect(actions.updateExpense).toHaveBeenCalledWith(expect.objectContaining({ expenseId: GROUP, expectedVersion: 3 })),
    );
  });

  it("switching to a friend limits the people to the two of you", async () => {
    const user = renderForm();
    await user.selectOptions(screen.getByLabelText("Split with"), "Friend · Bina");
    expect(screen.getByRole("checkbox", { name: "Include Asha" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Include Bina" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Include Chetan" })).not.toBeInTheDocument();
  });

  describe("repeat", () => {
    it("doesn't repeat by default and saves a plain expense", async () => {
      actions.createExpense.mockResolvedValue(undefined);
      const user = renderForm();
      expect(screen.getByLabelText("Repeat")).toHaveValue("never");
      expect(screen.queryByLabelText("Time zone")).not.toBeInTheDocument();
      await user.type(screen.getByLabelText("Description"), "Dinner");
      await user.type(screen.getByLabelText("Amount"), "900");
      await user.click(save());
      await vi.waitFor(() => expect(actions.createExpense).toHaveBeenCalledTimes(1));
      expect(recurringActions.createRecurringExpense).not.toHaveBeenCalled();
    });

    it("explains month ends, previews the next dates and saves a recurring expense", async () => {
      recurringActions.createRecurringExpense.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(
        <ExpenseForm
          options={options}
          mode={{ kind: "create" }}
          defaultValues={{
            ...blankExpenseValues({ splitWith: `group:${GROUP}`, userIds: [A, B, C], paidBy: A, currency: "INR", date: "2027-01-31" }),
            repeat: { frequency: "never", endDate: "", timezone: "Asia/Kolkata" },
          }}
        />,
      );
      await user.selectOptions(screen.getByLabelText("Repeat"), "Every month");
      expect(screen.getByLabelText("First date")).toBeInTheDocument();
      expect(screen.getByLabelText("Time zone")).toHaveValue("Asia/Kolkata");
      expect(screen.getByText("Every month on the 31st (the last day in shorter months).")).toBeInTheDocument();
      expect(screen.getByText("Next: 31 Jan 2027, 28 Feb 2027, 31 Mar 2027")).toBeInTheDocument();

      await user.type(screen.getByLabelText("Description"), "Rent");
      await user.type(screen.getByLabelText("Amount"), "30000");
      await user.click(screen.getByRole("button", { name: "Save recurring expense" }));
      await vi.waitFor(() => expect(recurringActions.createRecurringExpense).toHaveBeenCalledTimes(1));
      const [call] = recurringActions.createRecurringExpense.mock.calls[0] ?? [];
      expect(call.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
      expect(call.values).toMatchObject({
        description: "Rent",
        date: "2027-01-31",
        repeat: { frequency: "monthly", endDate: "", timezone: "Asia/Kolkata" },
      });
      expect(actions.createExpense).not.toHaveBeenCalled();
    });

    it("refuses an end date before the first date", async () => {
      const user = renderForm();
      await user.selectOptions(screen.getByLabelText("Repeat"), "Every week");
      await user.type(screen.getByLabelText("Description"), "Cleaner");
      await user.type(screen.getByLabelText("Amount"), "900");
      await user.type(screen.getByLabelText("Ends on (optional)"), "2026-10-01");
      await user.click(screen.getByRole("button", { name: "Save recurring expense" }));
      expect(await screen.findByText("The end date must be on or after the first date.")).toBeInTheDocument();
      expect(recurringActions.createRecurringExpense).not.toHaveBeenCalled();
    });

    it("edits a recurring expense with its version and can't turn the repeat off", async () => {
      recurringActions.updateRecurringExpense.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(
        <ExpenseForm
          options={options}
          mode={{ kind: "edit-recurring", recurringId: GROUP, expectedVersion: 2 }}
          defaultValues={{
            ...blankExpenseValues({ splitWith: `group:${GROUP}`, userIds: [A, B, C], paidBy: A, currency: "INR", date: "2026-10-01" }),
            description: "Rent",
            amount: "30000",
            repeat: { frequency: "monthly", endDate: "", timezone: "UTC" },
          }}
        />,
      );
      expect(screen.getByLabelText("Split with")).toBeDisabled();
      expect(within(screen.getByLabelText("Repeat")).queryByRole("option", { name: "Doesn't repeat" })).toBeNull();
      await user.click(screen.getByRole("button", { name: "Save changes" }));
      await vi.waitFor(() =>
        expect(recurringActions.updateRecurringExpense).toHaveBeenCalledWith(
          expect.objectContaining({ recurringId: GROUP, expectedVersion: 2 }),
        ),
      );
    });

    it("editing a single expense offers no repeat", () => {
      render(
        <ExpenseForm
          options={options}
          mode={{ kind: "edit", expenseId: GROUP, expectedVersion: 1 }}
          defaultValues={blankExpenseValues({ splitWith: `group:${GROUP}`, userIds: [A, B, C], paidBy: A, currency: "INR", date: "2026-10-21" })}
        />,
      );
      expect(screen.queryByLabelText("Repeat")).not.toBeInTheDocument();
    });
  });
});
