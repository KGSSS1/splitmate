"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { applyTheme, isTheme, type Theme, THEME_CHANGE_EVENT, THEME_STORAGE_KEY } from "@/lib/theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The saved theme preference and a setter; `system` until hydrated. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system" as const);

  // Keep <html> in sync with the preference, the OS setting and other tabs.
  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const sync = () => applyTheme(theme, media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable (private mode); the theme still applies for this page.
    }
    applyTheme(next, window.matchMedia(DARK_QUERY).matches);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }, []);

  return [theme, setTheme];
}
