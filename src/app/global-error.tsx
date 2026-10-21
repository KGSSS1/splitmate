"use client";

import { useEffect } from "react";

import { brand } from "@/config/brand";

// Replaces the root layout, so globals.css and the theme script are not loaded:
// inline styles only, following the OS colour scheme.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          colorScheme: "light dark",
          textAlign: "center",
          padding: "1rem",
        }}
      >
        <title>{`Something went wrong · ${brand.name}`}</title>
        <main>
          <h1 style={{ fontSize: "1.25rem" }}>Something went wrong</h1>
          <p>{brand.name} couldn&apos;t load. Your data is safe; nothing was changed.</p>
          <button
            type="button"
            onClick={retry}
            style={{
              minHeight: 44,
              padding: "0 1.25rem",
              border: 0,
              borderRadius: 8,
              background: brand.colors.primary,
              color: "#fff",
              font: "inherit",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
