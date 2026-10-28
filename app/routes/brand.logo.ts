import { getDb, schema } from "~/server/db";
import type { Route } from "./+types/brand.logo";

// The business logo for documents, emails and the portal. Public by design (it
// appears in client emails); uploaded SVGs are served sandboxed so any script
// inside can't run.
export async function loader({ context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const [business] = await getDb(env)
    .select({ logoKey: schema.business.logoKey })
    .from(schema.business)
    .limit(1);
  if (!business?.logoKey) throw new Response("Not found", { status: 404 });
  const object = await env.FILES.get(business.logoKey);
  if (!object) throw new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "public, max-age=300",
      ETag: object.httpEtag,
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
