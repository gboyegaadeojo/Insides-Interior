// Team (FR-AUTH-03/04): an owner invites staff or another owner; there is no
// registration. An invitation creates the user row (the sign-in allow-list)
// and emails a magic link. Owners can turn off anyone's access but their own,
// so the business always keeps at least one active owner.

import { and, asc, eq, isNull } from "drizzle-orm";
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
      businessEmails: schema.user.businessEmails,
    })
    .from(schema.user)
    .where(eq(schema.user.businessId, ctx.user.businessId))
    .orderBy(asc(schema.user.createdAt));
}

async function sendSignInLink(ctx: RequestContext, request: Request, email: string, name: string) {
  const auth = createAuth(ctx.env, request, { invite: { name } });
  await auth.api.signInMagicLink({ body: { email, callbackURL: "/" }, headers: request.headers });
}

export async function inviteMember(
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
      role: input.role,
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
      data: { email: input.email, role: input.role },
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
  if (userId === ctx.user.id) throw new ServiceError("You can't turn off your own access");
  await teamMember(ctx, userId);
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

/**
 * Owner or staff. Anyone's role can change, your own included (the developer
 * hands over by making themselves staff), as long as another active owner who
 * has signed in remains, so the business is never left without an owner.
 */
export async function setMemberRole(ctx: RequestContext, userId: string, role: "owner" | "staff") {
  const member = await teamMember(ctx, userId);
  if (member.role === role) return;
  if (role === "staff") {
    const owners = await ctx.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(
        and(
          eq(schema.user.businessId, ctx.user.businessId),
          eq(schema.user.role, "owner"),
          eq(schema.user.emailVerified, true),
          isNull(schema.user.disabledAt),
          eq(schema.user.businessEmails, true),
        ),
      );
    if (!owners.some((o) => o.id !== userId))
      throw new ServiceError(
        "Another owner who gets the business emails must have signed in first, so the business always has one",
      );
  }
  await ctx.db.batch([
    ctx.db.update(schema.user).set({ role, updatedAt: new Date() }).where(eq(schema.user.id, userId)),
    activityInsert(ctx.db, {
      businessId: ctx.user.businessId,
      actor: { type: "user", id: ctx.user.id },
      entityType: "user",
      entityId: userId,
      action: "team.role_changed",
      data: { from: member.role, to: role },
    }),
  ]);
}

/**
 * Whether an owner gets the business emails (owner request 2026-10-31: the
 * developer stays an owner without the alerts). At least one active owner
 * always keeps them, so nothing important goes unread.
 */
export async function setBusinessEmails(ctx: RequestContext, userId: string, on: boolean) {
  const member = await teamMember(ctx, userId);
  if (member.role !== "owner") throw new ServiceError("Only owners get the business emails");
  if (!on) {
    const others = await ctx.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(
        and(
          eq(schema.user.businessId, ctx.user.businessId),
          eq(schema.user.role, "owner"),
          isNull(schema.user.disabledAt),
          eq(schema.user.businessEmails, true),
        ),
      );
    if (!others.some((o) => o.id !== userId))
      throw new ServiceError("At least one owner must get the business emails");
  }
  await ctx.db.batch([
    ctx.db
      .update(schema.user)
      .set({ businessEmails: on, updatedAt: new Date() })
      .where(eq(schema.user.id, userId)),
    activityInsert(ctx.db, {
      businessId: ctx.user.businessId,
      actor: { type: "user", id: ctx.user.id },
      entityType: "user",
      entityId: userId,
      action: on ? "team.emails_on" : "team.emails_off",
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
