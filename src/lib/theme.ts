/**
 * Light/dark theme preference, stored per browser in localStorage. The `dark`
 * class on <html> switches the CSS tokens in src/app/globals.css.
 */
export const THEME_STORAGE_KEY = "splitmate-theme";
export const THEME_CHANGE_EVENT = "splitmate-theme-change";

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/** Applies `theme` to <html>; `system` follows the OS setting. */
export function applyTheme(theme: Theme, prefersDark: boolean): void {
  const dark = theme === "dark" || (theme === "system" && prefersDark);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

/**
 * Inline script for <head>: applies the saved theme before first paint so the
 * page never flashes the wrong theme. Mirrors `applyTheme`.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light"}catch(e){}})()`;
