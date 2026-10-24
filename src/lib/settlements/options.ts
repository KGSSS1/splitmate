import type { SettlementStatus } from "@/lib/accounting/types";

/** How a repayment was made (SPEC §11). Nothing is paid through SplitMate itself. */
export const SETTLEMENT_METHODS = ["cash", "bank_transfer", "upi", "other"] as const;
export type SettlementMethod = (typeof SETTLEMENT_METHODS)[number];

export const SETTLEMENT_METHOD_LABELS: Record<SettlementMethod, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  upi: "UPI (recorded manually)",
  other: "Other",
};

export const SETTLEMENT_METHOD_OPTIONS = SETTLEMENT_METHODS.map((value) => ({
  value,
  label: SETTLEMENT_METHOD_LABELS[value],
}));

export function isSettlementMethod(value: unknown): value is SettlementMethod {
  return typeof value === "string" && (SETTLEMENT_METHODS as readonly string[]).includes(value);
}

export function settlementMethodLabel(value: string): string {
  return isSettlementMethod(value) ? SETTLEMENT_METHOD_LABELS[value] : "Other";
}

export const SETTLEMENT_STATUSES = ["pending", "completed", "rejected", "withdrawn", "cancelled"] as const;

export function isSettlementStatus(value: unknown): value is SettlementStatus {
  return typeof value === "string" && (SETTLEMENT_STATUSES as readonly string[]).includes(value);
}

export const SETTLEMENT_STATUS_LABELS: Record<SettlementStatus, string> = {
  pending: "Waiting for confirmation",
  completed: "Completed",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  cancelled: "Cancelled",
};

/** "I paid them" or "they paid me": the viewer is always one of the two people. */
export const SETTLEMENT_DIRECTIONS = ["paid", "received"] as const;
export type SettlementDirection = (typeof SETTLEMENT_DIRECTIONS)[number];

export const SETTLEMENTS_PAGE_SIZE = 20;
