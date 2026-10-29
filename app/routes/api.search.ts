import { searchRecords } from "~/features/search/service";
import { requireUser } from "~/server/session";
import type { Route } from "./+types/api.search";

// Command palette records (FR-SYS-01). GET only: searching never writes.
export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireUser(context.cloudflare.env, request);
  const query = new URL(request.url).searchParams.get("q") ?? "";
  return { query, hits: await searchRecords(ctx, query) };
}
