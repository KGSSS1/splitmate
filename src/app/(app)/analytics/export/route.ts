import { todayIn } from "@/lib/expenses/dates";
import { createClient } from "@/lib/supabase/server";
import { parseReportFilters } from "@/lib/validation/analytics";
import { TooManyRowsError } from "@/server/analytics";
import { requireOnboardedProfile } from "@/server/auth";
import { buildExpensesCsv, buildSettlementsCsv, isExportKind } from "@/server/exports";

const NO_STORE = { "Cache-Control": "private, no-store" };

function plain(status: number, message: string) {
  return new Response(message, { status, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });
}

/**
 * CSV export (SPEC §14), generated on the server with the viewer's own session,
 * so RLS decides which rows can appear. Same filters as the analytics page:
 * `?kind=expenses|settlements&range=…&from=…&to=…`.
 */
export async function GET(request: Request) {
  const profile = await requireOnboardedProfile();
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const kind = params.kind ?? "expenses";
  if (!isExportKind(kind)) return plain(400, "Unknown export.");

  const { filters, error } = parseReportFilters(params, todayIn(profile.timezone));
  if (error) return plain(400, error);

  const supabase = await createClient();
  try {
    const file =
      kind === "expenses"
        ? await buildExpensesCsv(supabase, filters.range)
        : await buildSettlementsCsv(supabase, profile.id, filters.range);
    return new Response(file.body, {
      headers: {
        ...NO_STORE,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (cause) {
    if (cause instanceof TooManyRowsError) return plain(413, "Too many records in this range. Choose a shorter range.");
    return plain(500, "Could not create the export. Please try again.");
  }
}
