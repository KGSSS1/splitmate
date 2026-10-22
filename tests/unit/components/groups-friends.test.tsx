import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AddFriendForm } from "@/components/friends/add-friend-form";
import { ActionButton } from "@/components/shared/action-button";
import { BalanceText } from "@/components/shared/balance-text";

const friendActions = vi.hoisted(() => ({ addFriend: vi.fn() }));
vi.mock("@/server/actions/friends", () => friendActions);

describe("BalanceText", () => {
  it("says settled up when there is nothing owed", () => {
    render(<BalanceText balances={[]} perspective="friend" />);
    expect(screen.getByText("Settled up")).toBeInTheDocument();
  });

  it("words each currency from the right point of view, never relying on colour", () => {
    const balances = [
      { currency: "INR", amount: 30000 },
      { currency: "USD", amount: -1250 },
    ];
    const { rerender } = render(<BalanceText balances={balances} perspective="friend" />);
    expect(screen.getByText("owes you ₹300.00")).toBeInTheDocument();
    // en-IN writes US dollars as "$12.50"; the exact symbol is Intl's business.
    expect(screen.getByText(/^you owe \S*12\.50$/)).toBeInTheDocument();

    rerender(<BalanceText balances={balances} perspective="self" />);
    expect(screen.getByText("you are owed ₹300.00")).toBeInTheDocument();

    rerender(<BalanceText balances={balances} perspective="member" />);
    expect(screen.getByText("is owed ₹300.00")).toBeInTheDocument();
    expect(screen.getByText(/^owes \S*12\.50$/)).toBeInTheDocument();
  });
});

describe("ActionButton", () => {
  it("asks for confirmation before running a destructive action", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(
      <ActionButton action={action} confirm="Leave Goa trip?" confirmLabel="Leave group">
        Leave
      </ActionButton>,
    );

    await user.click(screen.getByRole("button", { name: "Leave" }));
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByText("Leave Goa trip?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(action).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Leave" }));
    await user.click(screen.getByRole("button", { name: "Leave group" }));
    expect(action).toHaveBeenCalledOnce();
  });

  it("shows the server's error", async () => {
    const action = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "The balance in this group must be zero in every currency first." });
    const user = userEvent.setup();
    render(<ActionButton action={action}>Remove</ActionButton>);

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("must be zero in every currency");
  });

  it("reports a network failure without claiming success", async () => {
    const action = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const user = userEvent.setup();
    render(<ActionButton action={action}>Accept</ActionButton>);

    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach the server");
  });
});

describe("AddFriendForm", () => {
  beforeEach(() => friendActions.addFriend.mockReset());

  it("validates the email before calling the server", async () => {
    const user = userEvent.setup();
    render(<AddFriendForm />);
    await user.type(screen.getByLabelText("Friend's email"), "bina");
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(friendActions.addFriend).not.toHaveBeenCalled();
  });

  it("sends the normalized email and shows the outcome", async () => {
    friendActions.addFriend.mockResolvedValue({ ok: true, message: "Friend request sent to Bina." });
    const user = userEvent.setup();
    render(<AddFriendForm />);
    await user.type(screen.getByLabelText("Friend's email"), " Bina@Example.com ");
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Friend request sent to Bina.");
    expect(friendActions.addFriend).toHaveBeenCalledWith({ email: "bina@example.com" });
    expect(screen.getByLabelText("Friend's email")).toHaveValue("");
  });

  it("shows an unknown email under the field", async () => {
    const message = "No SplitMate account uses that email address.";
    friendActions.addFriend.mockResolvedValue({ ok: false, error: message, fieldErrors: { email: message } });
    const user = userEvent.setup();
    render(<AddFriendForm />);
    await user.type(screen.getByLabelText("Friend's email"), "nobody@example.com");
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getAllByText(message)).toHaveLength(1);
  });

  it("shows other server errors, such as the rate limit, above the form", async () => {
    friendActions.addFriend.mockResolvedValue({ ok: false, error: "Too many attempts; try again later." });
    const user = userEvent.setup();
    render(<AddFriendForm />);
    await user.type(screen.getByLabelText("Friend's email"), "bina@example.com");
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts");
  });
});
