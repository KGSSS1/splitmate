import fc from "fast-check";
import { describe, expect, it } from "vitest";

describe("property tests", () => {
  // Review L42: the seed is fixed in tests/setup.ts, so generated cases repeat between runs.
  it("run with a fixed seed", () => {
    expect(fc.readConfigureGlobal().seed).toEqual(expect.any(Number));
    const sample = () => fc.sample(fc.integer(), { numRuns: 5 });
    expect(sample()).toEqual(sample());
  });
});
