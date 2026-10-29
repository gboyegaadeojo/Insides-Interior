import { documentPdf } from "~/features/documents/pdf";
import { loadPortalInvoice } from "~/features/portal/service";
import { pdfResponse } from "~/server/pdf-response";
import { limitPortal } from "~/server/portal-guard";
import type { Route } from "./+types/i.$token.pdf";

// The payer's PDF download from the invoice portal (SPEC 10.4).
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  await limitPortal(env, request);
  const portal = await loadPortalInvoice(env, params.token);
  if (!portal) throw new Response("This link isn't valid", { status: 404 });
  return pdfResponse(() => documentPdf(env, "invoice", portal.invoice.id));
}
