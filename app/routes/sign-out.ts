import { redirect } from "react-router";
import { createAuth } from "~/server/auth";
import { assertSameOrigin } from "~/server/session";
import type { Route } from "./+types/sign-out";

export function loader() {
  return redirect("/");
}

export async function action({ request, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const auth = createAuth(context.cloudflare.env, request);
  const { headers } = await auth.api.signOut({ headers: request.headers, returnHeaders: true });
  return redirect("/sign-in", { headers });
}
