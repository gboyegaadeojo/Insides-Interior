import { verifyFileSignature } from "~/server/files";
import type { Route } from "./+types/files.$";

// Serves a private R2 object when the signed URL is valid (SPEC 11.1). Logos
// have their own public route (brand/logo).
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const key = params["*"] ?? "";
  const url = new URL(request.url);
  if (!key || key.startsWith("logos/")) throw new Response("Not found", { status: 404 });
  if (!(await verifyFileSignature(env, key, url.searchParams.get("exp"), url.searchParams.get("sig")))) {
    throw new Response("This link has expired", { status: 403 });
  }
  const object = await env.FILES.get(key);
  if (!object) throw new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=600",
      ETag: object.httpEtag,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
