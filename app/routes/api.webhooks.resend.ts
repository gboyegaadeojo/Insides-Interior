import { applyResendEvent, resendEventSchema } from "~/features/email/service";
import { verifySvix } from "~/server/svix";
import type { Route } from "./+types/api.webhooks.resend";

// Resend delivery events (SPEC 9.3 step 4): Svix signature checked against the
// raw body, events older than 5 minutes refused (SPEC 11.1). Unknown events and
// emails answer 200 so Resend doesn't retry them forever.
export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  if (!env.RESEND_WEBHOOK_SECRET) return new Response("Webhook not configured", { status: 503 });
  const body = await request.text();
  const verified = await verifySvix(env.RESEND_WEBHOOK_SECRET, request.headers, body);
  if (!verified.ok) return new Response("Invalid signature", { status: 401 });

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const event = resendEventSchema.safeParse(json);
  if (!event.success) return Response.json({ ignored: true });
  const result = await applyResendEvent(env, event.data);
  return Response.json(result);
}

export function loader() {
  return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
}
