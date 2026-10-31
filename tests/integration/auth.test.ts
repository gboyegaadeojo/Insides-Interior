import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { emailedOwners } from "~/features/email/service";
import { inviteMember, setBusinessEmails, setMemberDisabled, setMemberRole } from "~/features/team/service";
import { createAuth } from "~/server/auth";
import { getDb, schema } from "~/server/db";
import { E2E_OWNER_EMAIL } from "~/server/db/seed-sql";
import { getUser } from "~/server/session";
import { appRequest, ownerContext, seed, testEnv } from "./helpers";

beforeEach(seed);

/** Requests a magic link for `email` and follows it, returning the verify response. */
async function signInWith(email: string) {
  let link: string | undefined;
  const auth = createAuth(testEnv, appRequest("/sign-in"), { onMagicLink: (url) => (link = url) });
  await auth.api.signInMagicLink({
    body: { email, callbackURL: "/", errorCallbackURL: "/sign-in" },
    headers: new Headers(),
  });
  if (!link) return { link: undefined, response: undefined };
  const response = await createAuth(testEnv, appRequest(link)).handler(appRequest(link));
  return { link, response };
}

function sessionCookie(response: Response) {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

describe("magic link sign-in (FR-AUTH-01/03)", () => {
  it("signs in an existing owner and sets a session cookie", async () => {
    const { response } = await signInWith(E2E_OWNER_EMAIL);
    expect(response!.status).toBe(302);
    expect(response!.headers.get("location")).toMatch(/\/$/);
    const cookie = sessionCookie(response!);
    expect(cookie).toMatch(/ii\.session_token=/);
    const user = await getUser(testEnv, appRequest("/", { headers: { cookie } }));
    expect(user).toMatchObject({ email: E2E_OWNER_EMAIL, role: "owner" });
  });

  it("never creates an account for an unknown email (no registration)", async () => {
    const { response } = await signInWith("stranger@example.com");
    expect(response!.headers.get("location")).toMatch(/error=/);
    const rows = await getDb(testEnv)
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, "stranger@example.com"));
    expect(rows).toHaveLength(0);
  });

  it("links are single use", async () => {
    const { link } = await signInWith(E2E_OWNER_EMAIL);
    const again = await createAuth(testEnv, appRequest(link!)).handler(appRequest(link!));
    expect(again.headers.get("location")).toMatch(/error=/);
  });

  it("stores only a hash of the token", async () => {
    const { link } = await signInWith(E2E_OWNER_EMAIL).then(async (r) => r);
    const token = new URL(link!).searchParams.get("token")!;
    const rows = await getDb(testEnv).select().from(schema.verification);
    expect(rows.some((r) => r.identifier.includes(token) || r.value.includes(token))).toBe(false);
  });
});

describe("staff (FR-AUTH-04)", () => {
  it("an invited person can sign in as staff; turning access off signs them out", async () => {
    const ctx = ownerContext();
    await inviteMember(ctx, appRequest("/settings/team"), {
      name: "Sam Helper",
      email: "sam@example.com",
      role: "staff",
    });
    const { response } = await signInWith("sam@example.com");
    const cookie = sessionCookie(response!);
    const staff = await getUser(testEnv, appRequest("/", { headers: { cookie } }));
    expect(staff).toMatchObject({ role: "staff", name: "Sam Helper" });

    await setMemberDisabled(ctx, staff!.id, true);
    expect(await getUser(testEnv, appRequest("/", { headers: { cookie } }))).toBeNull();
    const retry = await signInWith("sam@example.com");
    expect(retry.response?.headers.get("location") ?? "error=").toMatch(/error=/);
  });

  it("can't invite someone twice or turn off your own access", async () => {
    const ctx = ownerContext();
    await expect(
      inviteMember(ctx, appRequest("/"), { name: "Dup", email: E2E_OWNER_EMAIL, role: "staff" }),
    ).rejects.toThrow(/already/);
    await expect(setMemberDisabled(ctx, ctx.user.id, true)).rejects.toThrow(/your own/);
  });
});

describe("a second owner (handover)", () => {
  it("an invited owner gets full access and can turn off the first owner", async () => {
    const first = ownerContext();
    await inviteMember(first, appRequest("/settings/team"), {
      name: "New Owner",
      email: "new.owner@example.com",
      role: "owner",
    });
    const { response } = await signInWith("new.owner@example.com");
    const cookie = sessionCookie(response!);
    const second = await getUser(testEnv, appRequest("/", { headers: { cookie } }));
    expect(second).toMatchObject({ role: "owner", name: "New Owner" });

    const secondCtx = { ...first, user: second! };
    await setMemberDisabled(secondCtx, first.user.id, true);
    const [row] = await getDb(testEnv).select().from(schema.user).where(eq(schema.user.id, first.user.id));
    expect(row!.disabledAt).not.toBeNull();
    await expect(setMemberDisabled(secondCtx, second!.id, true)).rejects.toThrow(/your own/);
  });

  it("an owner can stop their business emails once another owner gets them (owner request)", async () => {
    const first = ownerContext();
    const db = getDb(testEnv);
    const recipients = async () => (await emailedOwners(db, first.user.businessId)).map((o) => o.id);

    // Start with this owner as the only one getting them (the handover test above turns their access off).
    await db.update(schema.user).set({ disabledAt: null }).where(eq(schema.user.id, first.user.id));
    for (const id of await recipients()) if (id !== first.user.id) await setBusinessEmails(first, id, false);
    expect(await recipients()).toEqual([first.user.id]);

    // The only owner getting them can't stop them, or be made staff.
    await expect(setBusinessEmails(first, first.user.id, false)).rejects.toThrow(/At least one owner/);
    await expect(setMemberRole(first, first.user.id, "staff")).rejects.toThrow(/Another owner/);

    await inviteMember(first, appRequest("/settings/team"), {
      name: "Business Owner",
      email: "business.owner@example.com",
      role: "owner",
    });
    await signInWith("business.owner@example.com");
    const [other] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, "business.owner@example.com"));

    await setBusinessEmails(first, first.user.id, false);
    expect(await recipients()).toEqual([other!.id]);
    // The first owner keeps full access.
    const [me] = await db.select().from(schema.user).where(eq(schema.user.id, first.user.id));
    expect(me).toMatchObject({ role: "owner", businessEmails: false, disabledAt: null });
    // Now the other owner is the last recipient and can't stop them.
    await expect(setBusinessEmails(first, other!.id, false)).rejects.toThrow(/At least one owner/);

    // Nor be made staff while they're the only one getting them.
    await expect(setMemberRole(first, other!.id, "staff")).rejects.toThrow(/Another owner/);

    await setBusinessEmails(first, first.user.id, true);
    await setMemberRole(first, other!.id, "staff");
    expect(await recipients()).toEqual([first.user.id]);
    await expect(setBusinessEmails(first, other!.id, true)).rejects.toThrow(/Only owners/);
    await setMemberRole(first, other!.id, "owner");
    expect((await recipients()).sort()).toEqual([first.user.id, other!.id].sort());
  });
});

describe("page-load session check (lean getUser)", () => {
  async function signedIn() {
    const { response } = await signInWith(E2E_OWNER_EMAIL);
    return sessionCookie(response!);
  }

  it("refuses a cookie whose signature doesn't match", async () => {
    const cookie = await signedIn();
    const [name, value] = cookie.split(/=(.*)/s) as [string, string];
    const decoded = decodeURIComponent(value);
    const token = decoded.slice(0, decoded.lastIndexOf("."));
    const forged = `${name}=${encodeURIComponent(`${token}.${"A".repeat(43)}=`)}`;
    expect(await getUser(testEnv, appRequest("/", { headers: { cookie: forged } }))).toBeNull();
  });

  it("refuses an expired session and renews one that is due", async () => {
    const cookie = await signedIn();
    const db = getDb(testEnv);
    const value = decodeURIComponent(cookie.split(/=(.*)/s)[1]!);
    const token = value.slice(0, value.lastIndexOf("."));
    const [row] = await db.select().from(schema.session).where(eq(schema.session.token, token));

    // Two days into a 30-day session: renewal is due.
    const due = new Date(Date.now() + 28 * 86_400_000);
    await db.update(schema.session).set({ expiresAt: due }).where(eq(schema.session.id, row!.id));
    expect(await getUser(testEnv, appRequest("/", { headers: { cookie } }))).not.toBeNull();
    const [renewed] = await db.select().from(schema.session).where(eq(schema.session.id, row!.id));
    expect(renewed!.expiresAt.getTime()).toBeGreaterThan(due.getTime());

    await db
      .update(schema.session)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.session.id, row!.id));
    expect(await getUser(testEnv, appRequest("/", { headers: { cookie } }))).toBeNull();
  });

  it("checks once per request", async () => {
    const request = appRequest("/", { headers: { cookie: await signedIn() } });
    expect(getUser(testEnv, request)).toBe(getUser(testEnv, request));
  });
});
