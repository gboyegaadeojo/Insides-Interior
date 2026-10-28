// Team (FR-AUTH-03/04): the owner invites staff; there is no registration.
// An invitation creates the user row (the sign-in allow-list) and emails a
// magic link.

import { and, asc, eq } from "drizzle-orm";
import type { z } from "zod";
import { ServiceError } from "~/features/settings/service";
import { newId } from "~/lib/ids";
import { activityInsert } from "~/server/audit";
import { createAuth } from "~/server/auth";
import { schema } from "~/server/db";
import type { RequestContext } from "~/server/session";
import type { inviteSchema } from "../settings/schema";

export async function listTeam(ctx: Pick<RequestContext, "db" | "user">) {
  return ctx.db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      role: schema.user.role,
      disabledAt: schema.user.disabledAt,
      emailVerified: schema.user.emailVerified,
    })
    .from(schema.user)
    .where(eq(schema.user.businessId, ctx.user.businessId))
    .orderBy(asc(schema.user.createdAt));
}

async function sendSignInLink(ctx: RequestContext, request: Request, email: string, name: string) {
  const auth = createAuth(ctx.env, request, { invite: { name } });
  await auth.api.signInMagicLink({ body: { email, callbackURL: "/" }, headers: request.headers });
}

export async function inviteStaff(
  ctx: RequestContext,
  request: Request,
  input: z.output<typeof inviteSchema>,
) {
  const [existing] = await ctx.db.select().from(schema.user).where(eq(schema.user.email, input.email));
  if (existing) throw new ServiceError("That person already has access", "email");
  const id = newId("usr");
  const now = new Date();
  await ctx.db.batch([
    ctx.db.insert(schema.user).values({
      id,
      name: input.name,
      email: input.email,
      role: "staff",
      businessId: ctx.user.businessId,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    }),
    activityInsert(ctx.db, {
      businessId: ctx.user.businessId,
      actor: { type: "user", id: ctx.user.id },
      entityType: "user",
      entityId: id,
      action: "team.invited",
      data: { email: input.email },
    }),
  ]);
  await sendSignInLink(ctx, request, input.email, input.name);
  return id;
}

export async function resendInvite(ctx: RequestContext, request: Request, userId: string) {
  const member = await teamMember(ctx, userId);
  if (member.disabledAt) throw new ServiceError("Turn their access back on first");
  await sendSignInLink(ctx, request, member.email, member.name);
}

/** Disabling signs the person out everywhere; history is kept. */
export async function setMemberDisabled(ctx: RequestContext, userId: string, disabled: boolean) {
  const member = await teamMember(ctx, userId);
  if (member.role === "owner") throw new ServiceError("The owner's access can't be turned off");
  await ctx.db.batch([
    ctx.db
      .update(schema.user)
      .set({ disabledAt: disabled ? new Date().toISOString() : null, updatedAt: new Date() })
      .where(eq(schema.user.id, userId)),
    ...(disabled ? [ctx.db.delete(schema.session).where(eq(schema.session.userId, userId))] : []),
    activityInsert(ctx.db, {
      businessId: ctx.user.businessId,
      actor: { type: "user", id: ctx.user.id },
      entityType: "user",
      entityId: userId,
      action: disabled ? "team.disabled" : "team.enabled",
    }),
  ]);
}

async function teamMember(ctx: RequestContext, userId: string) {
  const [member] = await ctx.db
    .select()
    .from(schema.user)
    .where(and(eq(schema.user.id, userId), eq(schema.user.businessId, ctx.user.businessId)));
  if (!member) throw new ServiceError("That person isn't on your team");
  return member;
}
