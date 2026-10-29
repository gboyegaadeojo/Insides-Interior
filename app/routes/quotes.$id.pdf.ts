import { and, eq } from "drizzle-orm";
import { quotePdf } from "~/features/quotes/pdf";
import { schema } from "~/server/db";
import { pdfResponse } from "~/server/pdf-response";
import { requireUser } from "~/server/session";
import type { Route } from "./+types/quotes.$id.pdf";

// The owner's download of a sent quote (SPEC 10.4), from the R2 cache.
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const ctx = await requireUser(context.cloudflare.env, request);
  const [row] = await ctx.db
    .select({ id: schema.quote.id })
    .from(schema.quote)
    .where(and(eq(schema.quote.id, params.id), eq(schema.quote.businessId, ctx.user.businessId)));
  if (!row) throw new Response("Not found", { status: 404 });
  return pdfResponse(() => quotePdf(ctx.env, row.id));
}
