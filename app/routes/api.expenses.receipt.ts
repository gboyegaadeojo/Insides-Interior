import { uploadReceipt } from "~/features/expenses/service";
import { ServiceError } from "~/features/settings/service";
import { signedFileUrl } from "~/server/files";
import { assertSameOrigin, requireUser } from "~/server/session";
import type { Route } from "./+types/api.expenses.receipt";

// FR-EXP-01: the receipt goes to R2 as soon as it's captured, with upload
// progress in the browser; the answer comes only after R2 has stored it.
export async function action({ request, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const ctx = await requireUser(context.cloudflare.env, request);
  const form = await request.formData();
  const file = form.get("receipt");
  if (!(file instanceof File)) return Response.json({ error: "Choose a receipt" }, { status: 400 });
  try {
    const stored = await uploadReceipt(ctx, file);
    return Response.json({ ...stored, url: await signedFileUrl(ctx.env, stored.key) });
  } catch (error) {
    if (error instanceof ServiceError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

export function loader() {
  throw new Response("Not found", { status: 404 });
}
