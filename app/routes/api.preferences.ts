import { data, redirect } from "react-router";
import { preferenceCookies } from "~/lib/preferences";
import type { Route } from "./+types/api.preferences";

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const cookies = preferenceCookies(form, new URL(request.url).protocol === "https:");
  if (cookies.length === 0) return data({ ok: false }, { status: 400 });
  const headers = new Headers();
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);

  // Without JavaScript the form posts normally; send the person back.
  const back = form.get("redirectTo");
  if (typeof back === "string" && back.startsWith("/") && !back.startsWith("//")) {
    return redirect(back, { headers });
  }
  return data({ ok: true }, { headers });
}
