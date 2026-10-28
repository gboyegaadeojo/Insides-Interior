import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { inviteMember, setMemberDisabled } from "~/features/team/service";
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
});
