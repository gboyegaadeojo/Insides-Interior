import { z } from "zod";
import { MESSAGE_MAX } from "~/features/portal/schema";

// Owner actions on a conversation (SPEC 5.14): reply, resolve change requests,
// hide or show a client message.

const id = z.string().min(1).max(64);

export const replySchema = z.object({
  intent: z.literal("reply"),
  body: z.string().trim().min(1, "Write a reply").max(MESSAGE_MAX, "Use 2,000 characters or fewer"),
});

export const resolveSchema = z.object({
  intent: z.literal("resolve"),
  decision: z.enum(["accept", "decline", "answer"]),
  requestIds: z.array(id).min(1, "Choose at least one request").max(50),
  /** Decline: the reason (required). Accept and answer: optional words for the client. */
  note: z.string().trim().max(MESSAGE_MAX, "Use 2,000 characters or fewer").default(""),
  /** An invoice with payments is voided and reissued with the changes (FR-MSG-06). */
  reissue: z
    .literal("on")
    .optional()
    .transform((v) => v === "on"),
});

export const hideSchema = z.object({
  intent: z.enum(["hide", "unhide"]),
  messageId: id,
});

export const threadActionSchema = z.discriminatedUnion("intent", [
  replySchema,
  resolveSchema,
  hideSchema.extend({ intent: z.literal("hide") }),
  hideSchema.extend({ intent: z.literal("unhide") }),
]);

export type ResolveInput = z.output<typeof resolveSchema>;
export type ThreadAction = z.output<typeof threadActionSchema>;
