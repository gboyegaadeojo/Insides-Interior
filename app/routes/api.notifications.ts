import { z } from "zod";
import {
  listNotifications,
  markNotificationsRead,
  unreadNotifications,
} from "~/features/notifications/service";
import { assertSameOrigin, requireUser } from "~/server/session";
import type { Route } from "./+types/api.notifications";

// The bell (FR-SYS-02): GET lists the latest notifications; POST marks some or
// all of them read.

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireUser(context.cloudflare.env, request);
  const [items, unread] = await Promise.all([listNotifications(ctx), unreadNotifications(ctx)]);
  return { items, unread };
}

const markSchema = z.union([
  z.object({ all: z.literal("1") }),
  z.object({ id: z.array(z.string().min(1).max(64)).min(1).max(100) }),
]);

export async function action({ request, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const ctx = await requireUser(context.cloudflare.env, request);
  const form = await request.formData();
  const parsed = markSchema.safeParse(form.get("all") ? { all: form.get("all") } : { id: form.getAll("id") });
  if (!parsed.success) return { ok: false as const };
  await markNotificationsRead(ctx, "all" in parsed.data ? "all" : parsed.data.id);
  return { ok: true as const };
}
