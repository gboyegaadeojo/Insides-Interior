import { loadPortalQuote } from "~/features/portal/service";
import { quotePdf } from "~/features/quotes/pdf";
import { pdfResponse } from "~/server/pdf-response";
import { limitPortal } from "~/server/portal-guard";
import type { Route } from "./+types/q.$token.pdf";

// The client's PDF download from the portal (SPEC 10.4).
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  await limitPortal(env, request);
  const portal = await loadPortalQuote(env, params.token);
  if (!portal) throw new Response("This link isn't valid", { status: 404 });
  return pdfResponse(() => quotePdf(env, portal.quote.id));
}
