import { AccountingError } from "@/lib/accounting/errors";
import type { SettlementStatus, UserId } from "@/lib/accounting/types";

/**
 * Settlement state machine (SPEC §2, §11). Only `completed` affects balances:
 * "apply" means write the settlement's ledger entry, "reverse" means write its
 * reversal, "none" means no ledger change.
 */
export type SettlementAction = "confirm" | "reject" | "cancel";
export type LedgerEffect = "apply" | "reverse" | "none";

export interface SettlementOutcome {
  status: SettlementStatus;
  ledgerEffect: LedgerEffect;
}

export interface SettlementParties {
  payerId: UserId;
  receiverId: UserId;
}

function requireParty(parties: SettlementParties, actorId: UserId): "payer" | "receiver" {
  if (parties.payerId === parties.receiverId) {
    throw new AccountingError("SAME_USER", "A settlement needs two different people");
  }
  if (actorId === parties.payerId) return "payer";
  if (actorId === parties.receiverId) return "receiver";
  throw new AccountingError("NOT_A_PARTY", "Only the payer or receiver can act on a settlement");
}

/**
 * Recorded by the receiver → completed immediately.
 * Recorded by the payer → pending until the receiver confirms, so nobody can
 * clear their own debt unilaterally.
 */
export function initialSettlementStatus(parties: SettlementParties, recordedBy: UserId): SettlementOutcome {
  return requireParty(parties, recordedBy) === "receiver"
    ? { status: "completed", ledgerEffect: "apply" }
    : { status: "pending", ledgerEffect: "none" };
}

/**
 * pending   --confirm (receiver)-->  completed (apply)
 * pending   --reject  (receiver)-->  rejected
 * pending   --cancel  (payer)----->  cancelled (withdrawn before confirmation)
 * completed --cancel  (either)---->  cancelled (reverse)
 * rejected and cancelled are final. Completing twice is impossible, so a
 * settlement is never counted twice.
 */
export function transitionSettlement(
  settlement: SettlementParties & { status: SettlementStatus },
  action: SettlementAction,
  actorId: UserId,
): SettlementOutcome {
  const role = requireParty(settlement, actorId);
  const invalid = () =>
    new AccountingError("INVALID_TRANSITION", `Cannot ${action} a ${settlement.status} settlement`);

  switch (settlement.status) {
    case "pending":
      if (action === "cancel") {
        if (role !== "payer") throw new AccountingError("NOT_ALLOWED", "The receiver rejects instead of cancelling");
        return { status: "cancelled", ledgerEffect: "none" };
      }
      if (role !== "receiver") {
        throw new AccountingError("NOT_ALLOWED", "Only the receiver can confirm or reject a pending settlement");
      }
      return action === "confirm"
        ? { status: "completed", ledgerEffect: "apply" }
        : { status: "rejected", ledgerEffect: "none" };
    case "completed":
      if (action !== "cancel") throw invalid();
      return { status: "cancelled", ledgerEffect: "reverse" };
    case "rejected":
    case "cancelled":
      throw invalid();
    default:
      // Status values can come from the database; never fall through on an unknown one.
      throw invalid();
  }
}

/**
 * The actions `actorId` may take on a settlement right now, in display order.
 * Mirrors `transitionSettlement` (and the database functions); the database
 * still decides, so this only chooses which buttons to show.
 */
export function availableSettlementActions(
  settlement: SettlementParties & { status: SettlementStatus },
  actorId: UserId,
): SettlementAction[] {
  if (actorId !== settlement.payerId && actorId !== settlement.receiverId) return [];
  return (["confirm", "reject", "cancel"] as const).filter((action) => {
    try {
      transitionSettlement(settlement, action, actorId);
      return true;
    } catch {
      return false;
    }
  });
}
