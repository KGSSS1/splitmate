// @vitest-environment node
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// Regression: an unanchored "supabase" pattern also matched src/lib/supabase/,
// so Vercel deployments were missing the Supabase clients and the build failed.
const patterns = readFileSync(".vercelignore", "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line !== "" && !line.startsWith("#"));

describe(".vercelignore", () => {
  it("anchors every pattern to the repository root", () => {
    const unanchored = patterns.filter((pattern) => !pattern.replace(/^!/, "").startsWith("/"));
    expect(unanchored).toEqual([]);
  });

  it("never excludes the app's source or public files", () => {
    const touchesApp = patterns.filter((pattern) => /^!?\/(src|public)(\/|$)/.test(pattern));
    expect(touchesApp).toEqual([]);
  });

  it("keeps local secrets and the Supabase folder out of uploads", () => {
    expect(patterns).toContain("/.env*");
    expect(patterns).toContain("!/.env.example");
    expect(patterns).toContain("/supabase/");
  });
});
