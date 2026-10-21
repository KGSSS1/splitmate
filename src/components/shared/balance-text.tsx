import type { CounterpartyBalance } from "@/lib/accounting/summary";
import { formatMoney } from "@/lib/money/format";
import { cn } from "@/lib/utils";

/**
 * Whose point of view a balance is told from:
 * - `friend`: positive = they owe you (friend_balances)
 * - `self`: positive = you are owed (your net in a group)
 * - `member`: positive = this member is owed (another member's net in a group)
 */
export type BalancePerspective = "friend" | "self" | "member";

function sentence(perspective: BalancePerspective, amount: number, formatted: string): string {
  const positive = amount > 0;
  switch (perspective) {
    case "friend":
      return positive ? `owes you ${formatted}` : `you owe ${formatted}`;
    case "self":
      return positive ? `you are owed ${formatted}` : `you owe ${formatted}`;
    case "member":
      return positive ? `is owed ${formatted}` : `owes ${formatted}`;
  }
}

/**
 * One line per currency, worded so colour is never the only signal (SPEC §9).
 * No balances means settled up.
 */
export function BalanceText({
  balances,
  perspective,
  className,
}: {
  balances: readonly CounterpartyBalance[];
  perspective: BalancePerspective;
  className?: string;
}) {
  if (balances.length === 0) {
    return <p className={cn("text-sm text-muted-foreground", className)}>Settled up</p>;
  }
  return (
    <ul className={cn("grid gap-0.5 text-sm", className)}>
      {balances.map(({ currency, amount }) => (
        <li key={currency} className={cn("tabular-nums", amount > 0 ? "text-primary" : "text-destructive")}>
          {sentence(perspective, amount, formatMoney(Math.abs(amount), currency))}
        </li>
      ))}
    </ul>
  );
}
