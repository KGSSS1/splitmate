import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import fc from "fast-check";
import { afterEach } from "vitest";

// Review L42: property tests use a fixed seed, so every run checks the same
// cases and a failure reproduces. FC_SEED=<n> explores other inputs.
const DEFAULT_FC_SEED = 20261024;
const seed = Number(process.env.FC_SEED ?? DEFAULT_FC_SEED);
if (!Number.isSafeInteger(seed)) throw new Error("FC_SEED must be an integer.");
fc.configureGlobal({ seed });

afterEach(() => {
  cleanup();
});
