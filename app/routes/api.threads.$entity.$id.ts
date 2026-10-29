import { data, redirect } from "react-router";
import { threadActionSchema } from "~/features/conversations/schema";
import { postOwnerMessage, resolveRequests, setMessageHidden } from "~/features/conversations/service";
import { ServiceError } from "~/features/settings/service";
import { assertSameOrigin, requireUser } from "~/server/session";
import type { Route } from "./+types/api.threads.$entity.$id";

// Owner actions on a document's conversation (SPEC 5.14), posted by ThreadPanel
// from the document screens and the Inbox. Accepting change requests redirects
// to the draft revision it made.

export async function action({ request, params, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const ctx = await requireUser(context.cloudflare.env, request);
  if (params.entity !== "quote" && params.entity !== "invoice")
    throw new Response("Not found", { status: 404 });
  const entity = params.entity;
  const form = await request.formData();
  const parsed = threadActionSchema.safeParse({
    ...Object.fromEntries(form),
    requestIds: form.getAll("requestId"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return data(
      { ok: false as const, error: issue.message, field: String(issue.path[0] ?? ""), message: null },
      { status: 400 },
    );
  }
  const done = (message: string) => data({ ok: true as const, error: null, field: null, message });
  try {
    const input = parsed.data;
    switch (input.intent) {
      case "reply": {
        const { emailed } = await postOwnerMessage(ctx, entity, params.id, input.body);
        return done(emailed ? "Reply sent; the client gets it by email" : "Reply posted");
      }
      case "resolve": {
        const result = await resolveRequests(ctx, entity, params.id, input);
        if (result.redirectTo)
          return redirect(`${result.redirectTo}?notice=${encodeURIComponent(result.message)}`);
        return done(result.message);
      }
      case "hide":
      case "unhide":
        await setMessageHidden(ctx, input.messageId, input.intent === "hide");
        return done(input.intent === "hide" ? "Message hidden from the client" : "Message shown again");
    }
  } catch (error) {
    if (error instanceof ServiceError) {
      return data(
        { ok: false as const, error: error.message, field: error.field ?? null, message: null },
        { status: 400 },
      );
    }
    throw error;
  }
}
