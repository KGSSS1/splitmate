import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemePicker } from "@/components/theme/theme-picker";
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "@/lib/theme";

function mockSystemDark(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: dark && query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe("theme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    mockSystemDark(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the head script applies the saved theme, falling back to the OS setting", () => {
    // Runs the exact inline script shipped in <head>.
    const runScript = new Function(THEME_INIT_SCRIPT);

    mockSystemDark(true);
    runScript();
    expect(document.documentElement).toHaveClass("dark");

    localStorage.setItem(THEME_STORAGE_KEY, "light");
    runScript();
    expect(document.documentElement).not.toHaveClass("dark");

    mockSystemDark(false);
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    runScript();
    expect(document.documentElement).toHaveClass("dark");
  });

  it("the picker saves the choice and switches the theme", async () => {
    const user = userEvent.setup();
    render(<ThemePicker />);

    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "Light" }));
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("two pickers on one page stay in sync without sharing a radio group", async () => {
    const user = userEvent.setup();
    render(
      <>
        <ThemePicker />
        <ThemePicker />
      </>,
    );

    const [firstDark, secondDark] = screen.getAllByRole("radio", { name: "Dark" });
    await user.click(firstDark!);
    expect(firstDark).toBeChecked();
    expect(secondDark).toBeChecked();
  });

  it("follows changes made in another tab", () => {
    render(<ThemePicker />);
    act(() => {
      localStorage.setItem(THEME_STORAGE_KEY, "dark");
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY }));
    });
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
  });
});
