"use client";

import { useEffect } from "react";

import { FormStatus } from "./form-status";

/**
 * A success message carried by a redirect (`?saved=…`). On the first click or
 * key press on the page, the parameter is dropped from the URL, so the refresh
 * that follows a later action (confirming, commenting, …) doesn't show the
 * message again (review L17).
 */
export function RedirectNotice({ param, message }: { param: string; message: string }) {
  useEffect(() => {
    const forget = () => {
      const url = new URL(window.location.href);
      if (!url.searchParams.has(param)) return;
      url.searchParams.delete(param);
      // Next.js keeps its router in sync with the native History API.
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    };
    const options = { capture: true, once: true } as const;
    window.addEventListener("pointerdown", forget, options);
    window.addEventListener("keydown", forget, options);
    return () => {
      window.removeEventListener("pointerdown", forget, options);
      window.removeEventListener("keydown", forget, options);
    };
  }, [param]);

  return <FormStatus success={message} />;
}
