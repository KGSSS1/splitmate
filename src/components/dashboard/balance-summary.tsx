import { ArrowDownLeft, ArrowUpRight, Scale } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CurrencySummary } from "@/lib/accounting/summary";
import { formatMoney } from "@/lib/money/format";

/**
 * Owed / owing / net per currency. Colour is never the only signal: each
 * figure has a label and net amounts carry a sign and a sentence (SPEC §9).
 */
export function BalanceSummary({ summaries }: { summaries: readonly CurrencySummary[] }) {
  return (
    <div className="grid gap-6">
      {summaries.map((summary) => (
        <section key={summary.currency} aria-labelledby={`balances-${summary.currency}`} className="grid gap-3">
          {summaries.length > 1 ? (
            <h2 id={`balances-${summary.currency}`} className="text-sm font-medium text-muted-foreground">
              {summary.currency}
            </h2>
          ) : (
            <h2 id={`balances-${summary.currency}`} className="sr-only">
              Balances in {summary.currency}
            </h2>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label="You are owed"
              icon={ArrowDownLeft}
              value={formatMoney(summary.owedToYou, summary.currency)}
              tone={summary.owedToYou > 0 ? "positive" : "neutral"}
            />
            <Stat
              label="You owe"
              icon={ArrowUpRight}
              value={formatMoney(summary.youOwe, summary.currency)}
              tone={summary.youOwe > 0 ? "negative" : "neutral"}
            />
            <Stat
              label="Net balance"
              icon={Scale}
              value={formatMoney(summary.net, summary.currency, { signDisplay: "exceptZero" })}
              note={netNote(summary.net)}
              tone={summary.net > 0 ? "positive" : summary.net < 0 ? "negative" : "neutral"}
            />
          </div>
        </section>
      ))}
    </div>
  );
}

function netNote(net: number): string {
  if (net > 0) return "Overall, you are owed";
  if (net < 0) return "Overall, you owe";
  return "You're all settled up";
}

const TONES = {
  positive: "text-primary",
  negative: "text-destructive",
  neutral: "text-foreground",
} as const;

function Stat({
  label,
  icon: Icon,
  value,
  note,
  tone,
}: {
  label: string;
  icon: typeof Scale;
  value: string;
  note?: string;
  tone: keyof typeof TONES;
}) {
  return (
    <Card size="sm" role="group" aria-label={label}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Icon aria-hidden className="size-4" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1">
        <p className={`text-2xl font-semibold tabular-nums ${TONES[tone]}`}>{value}</p>
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </CardContent>
    </Card>
  );
}
