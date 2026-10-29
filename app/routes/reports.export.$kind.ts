import { EXPORT_KINDS } from "~/features/reports/constants";
import { exportCsv, exportPdfList } from "~/features/reports/service";
import { isIsoDate } from "~/lib/dates";
import { requireUser } from "~/server/session";
import type { Route } from "./+types/reports.export.$kind";

// FR-RPT-05: CSVs of invoices, payments and expenses for a date range, and the
// list of invoice PDFs the browser fetches into the ZIP (built client side, so
// the Worker's CPU budget isn't spent compressing).
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const ctx = await requireUser(context.cloudflare.env, request);
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!isIsoDate(from) || !isIsoDate(to) || from > to)
    throw new Response("Choose a valid date range", { status: 400 });
  const period = { from, to };
  if (params.kind === "pdfs") return Response.json({ pdfs: await exportPdfList(ctx, period) });
  const kind = EXPORT_KINDS.find((k) => `${k}.csv` === params.kind || k === params.kind);
  if (!kind) throw new Response("Not found", { status: 404 });
  return new Response(await exportCsv(ctx, kind, period), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="insides-${kind}-${from}-to-${to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
