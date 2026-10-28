import { createAuth } from "~/server/auth";
import type { Route } from "./+types/api.auth.$";

// Better Auth endpoints: magic-link verify, Google callback, passkeys, sessions.
export function loader({ request, context }: Route.LoaderArgs) {
  return createAuth(context.cloudflare.env, request).handler(request);
}

export function action({ request, context }: Route.ActionArgs) {
  return createAuth(context.cloudflare.env, request).handler(request);
}
