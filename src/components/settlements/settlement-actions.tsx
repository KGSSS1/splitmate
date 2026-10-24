import { ActionButton } from "@/components/shared/action-button";
import { formatMoney } from "@/lib/money/format";
import { cancelSettlement, confirmSettlement, rejectSettlement } from "@/server/actions/settlements";
import type { SettlementItem } from "@/server/settlements";

/**
 * The buttons for what the viewer may do with a settlement now: the receiver
 * confirms or rejects a pending one, the payer withdraws it, and either person
 * cancels a completed one (which reverses it in the ledger).
 */
export function SettlementActions({
  settlement,
  viewerId,
  compact = false,
}: {
  settlement: SettlementItem;
  viewerId: string;
  /** In a list row: only Confirm and Reject. */
  compact?: boolean;
}) {
  const { actions, status } = settlement;
  if (actions.length === 0) return null;
  const ref = { settlementId: settlement.id };
  const money = formatMoney(settlement.amount, settlement.currency);
  const from = settlement.payerId === viewerId ? "you" : settlement.payerName;

  return (
    <div className="flex flex-wrap items-start gap-2">
      {actions.includes("confirm") ? (
        <ActionButton variant="default" action={confirmSettlement.bind(null, ref)}>
          Confirm {money} from {from}
        </ActionButton>
      ) : null}
      {actions.includes("reject") ? (
        <ActionButton
          variant="outline"
          confirm="Reject this payment? Balances stay as they are."
          confirmLabel="Reject payment"
          action={rejectSettlement.bind(null, ref)}
        >
          Reject
        </ActionButton>
      ) : null}
      {!compact && actions.includes("cancel") ? (
        status === "pending" ? (
          <ActionButton
            variant="outline"
            confirm="Withdraw this payment record? It never changed any balance."
            confirmLabel="Withdraw"
            action={cancelSettlement.bind(null, ref)}
          >
            Withdraw
          </ActionButton>
        ) : (
          <ActionButton
            variant="destructive"
            confirm="Cancel this settlement? Its effect on balances will be reversed."
            confirmLabel="Cancel settlement"
            action={cancelSettlement.bind(null, ref)}
          >
            Cancel settlement
          </ActionButton>
        )
      ) : null}
    </div>
  );
}
