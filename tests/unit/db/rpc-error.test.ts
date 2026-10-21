import { describe, expect, it } from "vitest";

import { describeRpcError, GENERIC_RPC_ERROR, isRpcErrorCode } from "@/lib/db/rpc-error";

describe("describeRpcError", () => {
  it("passes SplitMate messages through as sentences, with their code", () => {
    expect(describeRpcError({ code: "SM409", message: "This invitation has been revoked" })).toEqual({
      message: "This invitation has been revoked.",
      code: "SM409",
    });
    expect(describeRpcError({ code: "SM429", message: "Too many attempts; try again later." })).toEqual({
      message: "Too many attempts; try again later.",
      code: "SM429",
    });
  });

  it("does not trust an empty or oversized message even with an SM code", () => {
    expect(describeRpcError({ code: "SM403", message: "" })).toEqual({ message: GENERIC_RPC_ERROR, code: "SM403" });
    expect(describeRpcError({ code: "SM403", message: "x".repeat(201) }).message).toBe(GENERIC_RPC_ERROR);
  });

  it("hides SQL details from constraint violations and anything else", () => {
    const constraint = describeRpcError({
      code: "23505",
      message: 'duplicate key value violates "friendships_pair_unique"',
    });
    expect(constraint.message).not.toContain("friendships");
    expect(constraint.code).toBeUndefined();
    expect(describeRpcError({ code: "42501", message: "permission denied for table groups" })).toEqual({
      message: GENERIC_RPC_ERROR,
    });
    expect(describeRpcError({})).toEqual({ message: GENERIC_RPC_ERROR });
  });

  it("recognises only the documented codes", () => {
    expect(isRpcErrorCode("SM404")).toBe(true);
    expect(isRpcErrorCode("SM500")).toBe(false);
    expect(isRpcErrorCode(undefined)).toBe(false);
  });
});
