import { data } from "react-router";
import type { ThreadEntity } from "~/features/conversations/requests";
import { changeRequestSchema, messageSchema } from "./schema";
import { PortalError, postClientMessage, raiseChangeRequest, type VisitorMeta } from "./service";

/**
 * The conversation writes of both portals (/q/:token, /i/:token): a message or
 * a change request, validated, run, and answered in one shape the page shows
 * inline. Approve stays in the quote route.
 */
export async function conversationAction(
  env: Env,
  entity: ThreadEntity,
  token: string,
  form: FormData,
  meta: VisitorMeta,
) {
  const intent = form.get("intent") === "message" ? "message" : "change_request";
  const fields = {
    intent,
    revisionId: form.get("revisionId"),
    name: form.get("name") ?? "",
    message: form.get("message") ?? "",
    lineRef: form.get("lineRef"),
    kind: form.get("kind") ?? undefined,
    quantity: form.get("quantity") ?? "",
    note: form.get("note") ?? "",
  };
  const parsed =
    intent === "message" ? messageSchema.safeParse(fields) : changeRequestSchema.safeParse(fields);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return data({ ok: false as const, intent, fieldErrors, error: null, code: "input" }, { status: 400 });
  }
  try {
    if (parsed.data.intent === "message") await postClientMessage(env, entity, token, parsed.data, meta);
    else await raiseChangeRequest(env, entity, token, parsed.data, meta);
    return data({ ok: true as const, intent, fieldErrors: {}, error: null, code: null });
  } catch (error) {
    if (error instanceof PortalError) {
      return data(
        {
          ok: false as const,
          intent,
          fieldErrors: error.field ? { [error.field]: error.message } : {},
          error: error.field ? null : error.message,
          code: error.code,
        },
        { status: error.code === "input" ? 400 : 409 },
      );
    }
    throw error;
  }
}
