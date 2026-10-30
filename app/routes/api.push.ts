import { z } from "zod";
import { removePushSubscription, savePushSubscription } from "~/features/notifications/service";
import { assertSameOrigin, requireUser } from "~/server/session";
import type { Route } from "./+types/api.push";

// Web Push subscriptions for the signed-in user's devices (owner request).
// POST saves this browser's subscription; DELETE removes it.
const subscriptionSchema = z.object({
  endpoint: z.url().startsWith("https://").max(1000),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/),
  }),
});

export async function action({ request, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const ctx = await requireUser(context.cloudflare.env, request);
  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ ok: false, error: "That isn't a push subscription" }, { status: 400 });
  if (request.method === "DELETE") {
    await removePushSubscription(ctx, parsed.data.endpoint);
    return Response.json({ ok: true });
  }
  await savePushSubscription(ctx, {
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
    userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
  });
  return Response.json({ ok: true });
}

export function loader() {
  throw new Response("Not found", { status: 404 });
}
