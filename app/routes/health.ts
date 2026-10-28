import { checkHealth } from "~/server/health";
import type { Route } from "./+types/health";

export async function loader({ context }: Route.LoaderArgs) {
  const health = await checkHealth(context.cloudflare.env);
  return Response.json(health, {
    status: health.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
