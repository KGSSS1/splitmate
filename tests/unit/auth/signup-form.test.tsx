import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SignUpForm } from "@/components/auth/signup-form";

const actions = vi.hoisted(() => ({ signUp: vi.fn() }));
vi.mock("@/server/actions/auth", () => actions);
const location = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(location.search) }));

describe("SignUpForm", () => {
  beforeEach(() => {
    actions.signUp.mockReset();
    location.search = "";
  });

  it("validates on the client before calling the server", async () => {
    const user = userEvent.setup();
    render(<SignUpForm />);

    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Use at least 8 characters.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(actions.signUp).not.toHaveBeenCalled();
  });

  it("sends normalized values and shows the server's error", async () => {
    actions.signUp.mockResolvedValue({ ok: false, error: "Too many attempts. Wait a minute and try again." });
    const user = userEvent.setup();
    render(<SignUpForm />);

    await user.type(screen.getByLabelText("Email"), " Asha@Example.com ");
    await user.type(screen.getByLabelText("Password"), "a-long-password");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts");
    expect(actions.signUp).toHaveBeenCalledWith({ email: "asha@example.com", password: "a-long-password" });
  });

  it("maps server field errors onto the fields", async () => {
    actions.signUp.mockResolvedValue({
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: { password: "Choose a stronger password." },
    });
    const user = userEvent.setup();
    render(<SignUpForm />);

    await user.type(screen.getByLabelText("Email"), "asha@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Choose a stronger password.")).toBeInTheDocument();
  });

  it("passes ?next= (e.g. an invitation) to the server", async () => {
    actions.signUp.mockResolvedValue(undefined);
    location.search = "?next=%2Finvite%2Fabc%3Fgroup%3Dg1";
    const user = userEvent.setup();
    render(<SignUpForm />);

    await user.type(screen.getByLabelText("Email"), "asha@example.com");
    await user.type(screen.getByLabelText("Password"), "a-long-password");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await vi.waitFor(() =>
      expect(actions.signUp).toHaveBeenCalledWith({
        email: "asha@example.com",
        password: "a-long-password",
        next: "/invite/abc?group=g1",
      }),
    );
  });
});
