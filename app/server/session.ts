// Route-level session and role checks (SPEC 7.4 rule 2, 11.2). Every app
// loader and action calls requireUser; owner-only screens call requireOwner.

import { eq } from "drizzle-orm";
import { redirect } from "react-router";
import { createAuth } from "./auth";
import { type Db, getDb, schema } from "./db";

export type Role = "owner" | "staff";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  businessId: string;
  sessionId: string;
}

export interface RequestContext {
  env: Env;
  db: Db;
  user: CurrentUser;
}

/** The signed-in user, or null. */
export async function getUser(env: Env, request: Request): Promise<CurrentUser | null> {
  const auth = createAuth(env, request);
  const result = await auth.api.getSession({ headers: request.headers });
  if (!result) return null;
  const db = getDb(env);
  const [member] = await db.select().from(schema.user).where(eq(schema.user.id, result.user.id)).limit(1);
  if (!member || member.disabledAt || !member.businessId) return null;
  return {
    id: member.id,
    name: member.name,
    email: member.email,
    role: member.role,
    businessId: member.businessId,
    sessionId: result.session.id,
  };
}

function signInRedirect(request: Request) {
  const url = new URL(request.url);
  const next = url.pathname + url.search;
  return redirect(next === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}`);
}

export async function requireUser(env: Env, request: Request): Promise<RequestContext> {
  const user = await getUser(env, request);
  if (!user) throw signInRedirect(request);
  return { env, db: getDb(env), user };
}

/** Settings, team, numbering, void, delete payment, export (SPEC 11.2). */
export async function requireOwner(env: Env, request: Request): Promise<RequestContext> {
  const ctx = await requireUser(env, request);
  if (ctx.user.role !== "owner") throw new Response("Only the owner can do that", { status: 403 });
  return ctx;
}

/** CSRF defence in depth for form actions (SPEC 11.1): same-origin only. */
export function assertSameOrigin(request: Request) {
  if (request.method === "GET" || request.method === "HEAD") return;
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new Response("Cross-site request refused", { status: 403 });
  }
}
