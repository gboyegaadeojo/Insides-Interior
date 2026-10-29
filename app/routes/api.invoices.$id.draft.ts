import { data } from "react-router";
import { saveInvoiceDraftSchema } from "~/features/invoices/schema";
import { InvoiceConflictError, saveInvoiceDraft } from "~/features/invoices/service";
import { ServiceError } from "~/features/settings/service";
import { assertSameOrigin, requireUser } from "~/server/session";
import type { Route } from "./+types/api.invoices.$id.draft";

// Autosave endpoint for the invoice builder (as FR-QT-06). JSON in, JSON out.
export async function action({ request, params, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const ctx = await requireUser(context.cloudflare.env, request);
  const body = await request.json().catch(() => null);
  const parsed = saveInvoiceDraftSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return data(
      { ok: false as const, error: issue?.message ?? "That draft isn't valid", field: issue?.path.join(".") },
      { status: 400 },
    );
  }
  try {
    const result = await saveInvoiceDraft(ctx, params.id, parsed.data);
    return { ok: true as const, ...result };
  } catch (error) {
    if (error instanceof InvoiceConflictError) {
      return data({ ok: false as const, conflict: { serverVersion: error.serverVersion } }, { status: 409 });
    }
    if (error instanceof ServiceError) {
      return data({ ok: false as const, error: error.message, field: error.field }, { status: 400 });
    }
    throw error;
  }
}
