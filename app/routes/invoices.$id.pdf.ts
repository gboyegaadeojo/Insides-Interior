import { and, eq } from "drizzle-orm";
import { documentPdf } from "~/features/documents/pdf";
import { schema } from "~/server/db";
import { pdfResponse } from "~/server/pdf-response";
import { requireUser } from "~/server/session";
import type { Route } from "./+types/invoices.$id.pdf";

// The owner's download of a sent invoice (SPEC 10.4), from the R2 cache.
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const ctx = await requireUser(context.cloudflare.env, request);
  const [row] = await ctx.db
    .select({ id: schema.invoice.id })
    .from(schema.invoice)
    .where(and(eq(schema.invoice.id, params.id), eq(schema.invoice.businessId, ctx.user.businessId)));
  if (!row) throw new Response("Not found", { status: 404 });
  return pdfResponse(() => documentPdf(ctx.env, "invoice", row.id));
}
