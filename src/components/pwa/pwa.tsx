"use client";

import { WifiOff } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** True when the browser reports no network. The server and first render assume online. */
export function useIsOffline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !navigator.onLine,
    () => false,
  );
}

/**
 * A clear banner while offline (SPEC §16). Nothing is queued: forms still try
 * the server and show their own network error, and nothing is shown as saved
 * until the server confirms it.
 */
export function OfflineBanner() {
  const offline = useIsOffline();
  return (
    <div role="status" aria-live="polite" className="contents">
      {offline ? (
        <p
          data-offline-banner
          className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-foreground px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 text-center text-sm font-medium text-background print:hidden"
        >
          <WifiOff aria-hidden className="size-4 shrink-0" />
          You&apos;re offline. You can look around, but nothing can be saved until you reconnect.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Registers /sw.js in production builds (in development it would serve stale
 * build files). The worker caches static assets and an offline page only.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Not supported or blocked (private mode): the app works the same without it.
    });
  }, []);
  return null;
}
