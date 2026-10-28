import { data } from "react-router";
import { createAuth } from "~/server/auth";
import type { Route } from "./+types/api.test.sign-in";

// Playwright sign-in helper for local runs and PR previews only. Returns a real
// magic link for the seeded E2E owner instead of emailing it, so tests exercise
// the genuine verify flow. Refused in production and without E2E_SECRET.
export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const secret = request.headers.get("x-e2e-secret");
  if (env.APP_ENV === "production" || !env.E2E_SECRET || secret !== env.E2E_SECRET) {
    throw new Response("Not found", { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as { email?: string; next?: string };
  let link: string | undefined;
  const auth = createAuth(env, request, { onMagicLink: (url) => (link = url) });
  await auth.api.signInMagicLink({
    body: { email: body.email ?? "e2e-owner@example.com", callbackURL: body.next ?? "/" },
    headers: request.headers,
  });
  if (!link) return data({ error: "No link" }, { status: 500 });
  return { url: link };
}

export function loader() {
  throw new Response("Not found", { status: 404 });
}
