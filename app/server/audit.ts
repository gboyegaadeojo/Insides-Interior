// Activity log writer (SPEC 8.2 `activity`, CLAUDE.md): every state change,
// message and email event is recorded. Returns the insert so callers can put it
// in the same D1 batch as the change it describes.

import type { Db } from "./db";
import { activity } from "./db/schema";
import { newId } from "~/lib/ids";

export type Actor = { type: "user"; id: string } | { type: "client" } | { type: "system" };

export function actorString(actor: Actor): string {
  return actor.type === "user" ? `user:${actor.id}` : actor.type;
}

export function activityInsert(
  db: Db,
  entry: {
    businessId: string;
    actor: Actor;
    entityType: string;
    entityId: string;
    action: string;
    data?: Record<string, unknown>;
  },
) {
  return db.insert(activity).values({
    id: newId("act"),
    businessId: entry.businessId,
    actor: actorString(entry.actor),
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    data: entry.data,
  });
}
