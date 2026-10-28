// Route-level session and role checks (SPEC 7.4 rule 2, 11.2). Every app
// loader and action calls requireUser; owner-only screens call requireOwner.

import { eq } from "drizzle-orm";
import { redirect } from "react-router";
import { SESSION_COOKIES, SESSION_UPDATE_AGE, THIRTY_DAYS } from "./auth";
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

// Page loads check the session here rather than through Better Auth's
// getSession: verify the signed cookie with a cached key, then one query joining
// session and user. Workers Free allows 10 ms of CPU per request and the full
// Better Auth path cost about 5 ms, run once per loader. Better Auth still owns
// sign-in, sign-out and passkeys (/api/auth/*).

let hmac: { secret: string; key: Promise<CryptoKey> } | undefined;

function hmacKey(secret: string) {
  if (hmac?.secret !== secret) {
    const key = crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    hmac = { secret, key };
  }
  return hmac.key;
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** The session token from Better Auth's signed cookie, or null if absent or forged. */
async function sessionToken(env: Env, request: Request): Promise<string | null> {
  const header = request.headers.get("cookie");
  for (const name of SESSION_COOKIES) {
    const value = readCookie(header, name);
    if (!value) continue;
    // Same format as better-call: "<token>.<base64 HMAC-SHA256>" (44 characters).
    const dot = value.lastIndexOf(".");
    const token = value.slice(0, dot);
    const signature = value.slice(dot + 1);
    if (dot < 1 || signature.length !== 44 || !signature.endsWith("=")) continue;
    try {
      const bytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
      const ok = await crypto.subtle.verify(
        "HMAC",
        await hmacKey(env.BETTER_AUTH_SECRET),
        bytes,
        new TextEncoder().encode(token),
      );
      if (ok) return token;
    } catch {
      // Malformed base64: treat as signed out.
    }
  }
  return null;
}

async function loadUser(env: Env, request: Request): Promise<CurrentUser | null> {
  const token = await sessionToken(env, request);
  if (!token) return null;
  const db = getDb(env);
  const [row] = await db
    .select({
      sessionId: schema.session.id,
      expiresAt: schema.session.expiresAt,
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      role: schema.user.role,
      businessId: schema.user.businessId,
      disabledAt: schema.user.disabledAt,
    })
    .from(schema.session)
    .innerJoin(schema.user, eq(schema.user.id, schema.session.userId))
    .where(eq(schema.session.token, token))
    .limit(1);
  const now = Date.now();
  if (!row || row.expiresAt.getTime() <= now || row.disabledAt || !row.businessId) return null;
  // Sliding renewal, as Better Auth's updateAge: extend at most once a day.
  if (row.expiresAt.getTime() - now < (THIRTY_DAYS - SESSION_UPDATE_AGE) * 1000) {
    await db
      .update(schema.session)
      .set({ expiresAt: new Date(now + THIRTY_DAYS * 1000), updatedAt: new Date(now) })
      .where(eq(schema.session.id, row.sessionId));
  }
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    businessId: row.businessId,
    sessionId: row.sessionId,
  };
}

// The app layout and the page loader both ask for the user; check once per request.
const perRequest = new WeakMap<Request, Promise<CurrentUser | null>>();

/** The signed-in user, or null. */
export function getUser(env: Env, request: Request): Promise<CurrentUser | null> {
  let user = perRequest.get(request);
  if (!user) {
    user = loadUser(env, request);
    perRequest.set(request, user);
  }
  return user;
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
