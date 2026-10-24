import { cn } from "@/lib/utils";

export interface ChartTable {
  caption: string;
  columns: readonly string[];
  /** Pre-formatted cells; the first one is the row's heading. */
  rows: readonly { key: string; cells: readonly string[] }[];
  /** Optional total row, also pre-formatted. */
  total?: readonly string[];
}

/** The chart's data as a table: the WCAG-clean equivalent, and what gets printed. */
export function DataTable({ table }: { table: ChartTable }) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{table.caption}</caption>
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          {table.columns.map((column, index) => (
            <th key={column} scope="col" className={cn("py-2 pr-3 font-medium", index > 0 && "text-right")}>
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row) => (
          <tr key={row.key} className="border-b last:border-b-0">
            {row.cells.map((cell, index) =>
              index === 0 ? (
                <th key={index} scope="row" className="py-2 pr-3 text-left font-normal">
                  {cell}
                </th>
              ) : (
                <td key={index} className="py-2 pr-3 text-right tabular-nums">
                  {cell}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
      {table.total ? (
        <tfoot>
          <tr className="border-t font-semibold">
            {table.total.map((cell, index) =>
              index === 0 ? (
                <th key={index} scope="row" className="py-2 pr-3 text-left">
                  {cell}
                </th>
              ) : (
                <td key={index} className="py-2 pr-3 text-right tabular-nums">
                  {cell}
                </td>
              ),
            )}
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}
