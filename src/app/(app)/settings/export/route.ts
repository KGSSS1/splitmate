import { createClient } from "@/lib/supabase/server";
import { requireLiveSession } from "@/server/auth";
import { buildAccountExport, buildDatasetCsv, ExportTooLargeError, isExportDataset } from "@/server/data-export";

const NO_STORE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

function plain(status: number, message: string) {
  return new Response(message, { status, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });
}

function attachment(body: string, type: string, fileName: string) {
  return new Response(body, {
    headers: { ...NO_STORE, "Content-Type": type, "Content-Disposition": `attachment; filename="${fileName}"` },
  });
}

/**
 * Data export (SPEC §8): `?format=json` for everything in one file, or
 * `?format=csv&dataset=<name>` for one table. Built with the viewer's own
 * session, so RLS decides every row. A live session is required: an export
 * holds more personal data than any single page.
 */
export async function GET(request: Request) {
  await requireLiveSession();
  const params = new URL(request.url).searchParams;
  const format = params.get("format") ?? "json";
  const day = new Date().toISOString().slice(0, 10);
  const supabase = await createClient();

  try {
    if (format === "json") {
      const data = await buildAccountExport(supabase);
      return attachment(`${JSON.stringify(data, null, 2)}\n`, "application/json; charset=utf-8", `splitmate-export-${day}.json`);
    }
    if (format === "csv") {
      const dataset = params.get("dataset");
      if (!isExportDataset(dataset)) return plain(400, "Unknown dataset.");
      return attachment(await buildDatasetCsv(supabase, dataset), "text/csv; charset=utf-8", `splitmate-${dataset}-${day}.csv`);
    }
    return plain(400, "Unknown format.");
  } catch (cause) {
    if (cause instanceof ExportTooLargeError) return plain(413, "Your data is too large to export in one file. Download the CSV files one by one instead.");
    return plain(500, "Could not create the export. Please try again.");
  }
}
