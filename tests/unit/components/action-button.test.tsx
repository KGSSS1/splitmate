import { Profiler } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ActionButton } from "@/components/shared/action-button";
import type { ActionResult } from "@/server/action-result";

describe("ActionButton", () => {
  // Review M17: the error used to commit before the button was re-enabled.
  // The Profiler callback runs at every commit, after the DOM is updated.
  it("shows the error and re-enables the button in the same commit", async () => {
    let release: (result: ActionResult) => void = () => {};
    const action = () =>
      new Promise<ActionResult>((resolve) => {
        release = resolve;
      });
    const badCommits: string[] = [];
    const check = () => {
      const alert = document.querySelector('[role="alert"]');
      const button = document.querySelector("button");
      if (alert && button?.disabled) badCommits.push(alert.textContent ?? "");
    };
    const user = userEvent.setup();
    render(
      <Profiler id="probe" onRender={check}>
        <ActionButton action={action}>Remind</ActionButton>
      </Profiler>,
    );

    await user.click(screen.getByRole("button", { name: "Remind" }));
    expect(screen.getByRole("button", { name: "Remind" })).toBeDisabled();
    await act(async () => release({ ok: false, error: "Try later" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Try later");
    expect(screen.getByRole("button", { name: "Remind" })).toBeEnabled();
    expect(badCommits).toEqual([]);
  });

  it("asks first when it needs confirmation", async () => {
    const action = vi.fn(async (): Promise<ActionResult> => ({ ok: true, data: undefined }));
    const user = userEvent.setup();
    render(
      <ActionButton action={action} confirm="Really?">
        Withdraw
      </ActionButton>,
    );
    await user.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(screen.getByText("Really?")).toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
  });
});
