import { Fingerprint, LogOut, Monitor, Smartphone } from "lucide-react";
import { ConfirmDelete } from "~/components/ui/confirm-delete";
import * as React from "react";
import { data, Form, redirect, useNavigation, useRevalidator } from "react-router";
import { SectionHeader } from "~/components/settings/section-header";
import { Button } from "~/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { TextField } from "~/components/ui/field";
import { toast } from "~/components/ui/toast";
import { authClient } from "~/lib/auth-client";
import { and, desc, eq, gt } from "drizzle-orm";
import { RouteErrorBoundary } from "~/components/shell/route-error";
import { BUSINESS_TZ, LOCALE } from "~/domain/locale";
import { createAuth } from "~/server/auth";
import { schema } from "~/server/db";
import { assertSameOrigin, requireUser } from "~/server/session";
import type { Route } from "./+types/account";

const DATE = new Intl.DateTimeFormat(LOCALE, {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: BUSINESS_TZ,
});

function describeDevice(userAgent: string | null | undefined) {
  const ua = userAgent ?? "";
  const device = /iPad/.test(ua)
    ? "iPad"
    : /iPhone/.test(ua)
      ? "iPhone"
      : /Android/.test(ua)
        ? "Android"
        : /Mac/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : "Device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Safari\//.test(ua)
        ? "Safari"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : "Browser";
  return { label: `${browser} on ${device}`, phone: /iPhone|Android/.test(ua) };
}

// Reads the user's own sessions and passkeys straight from the database, like
// every other page: no Better Auth call on a page load (Workers Free CPU, and a
// production-only failure of auth.api.listSessions took this page down). The
// sign-out and passkey actions below still go through Better Auth.
export async function loader({ request, context }: Route.LoaderArgs) {
  const { db, user } = await requireUser(context.cloudflare.env, request);
  const [sessions, passkeys] = await Promise.all([
    db
      .select({
        id: schema.session.id,
        token: schema.session.token,
        userAgent: schema.session.userAgent,
        updatedAt: schema.session.updatedAt,
      })
      .from(schema.session)
      .where(and(eq(schema.session.userId, user.id), gt(schema.session.expiresAt, new Date())))
      .orderBy(desc(schema.session.updatedAt)),
    db
      .select({ id: schema.passkey.id, name: schema.passkey.name, createdAt: schema.passkey.createdAt })
      .from(schema.passkey)
      .where(eq(schema.passkey.userId, user.id)),
  ]);
  return {
    user: { name: user.name, email: user.email },
    sessions: sessions
      .map((s) => ({
        token: s.token,
        current: s.id === user.sessionId,
        ...describeDevice(s.userAgent),
        lastActive: DATE.format(new Date(s.updatedAt)),
      }))
      .sort((a, b) => Number(b.current) - Number(a.current)),
    passkeys: passkeys.map((p) => ({
      id: p.id,
      name: p.name || "Passkey",
      createdAt: p.createdAt ? DATE.format(new Date(p.createdAt)) : null,
    })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const { env } = await requireUser(context.cloudflare.env, request);
  const auth = createAuth(env, request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  if (intent === "revoke") {
    await auth.api.revokeSession({ body: { token: String(form.get("token")) }, headers: request.headers });
    return data({ ok: true, message: "That device has been signed out" });
  }
  if (intent === "revoke-others") {
    await auth.api.revokeOtherSessions({ headers: request.headers });
    return data({ ok: true, message: "Signed out of every other device" });
  }
  if (intent === "revoke-all") {
    const { headers } = await auth.api.revokeSessions({ headers: request.headers, returnHeaders: true });
    const signOut = await auth.api
      .signOut({ headers: request.headers, returnHeaders: true })
      .catch(() => null);
    const out = new Headers(headers);
    signOut?.headers.forEach((value, key) => key.toLowerCase() === "set-cookie" && out.append(key, value));
    return redirect("/sign-in", { headers: out });
  }
  if (intent === "delete-passkey") {
    await auth.api.deletePasskey({ body: { id: String(form.get("id")) }, headers: request.headers });
    return data({ ok: true, message: "Passkey removed" });
  }
  throw new Response("Unknown action", { status: 400 });
}

export default function AccountSettings({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const pending = navigation.formData?.get("intent");
  const pendingToken = navigation.formData?.get("token");
  const revalidator = useRevalidator();
  const [adding, setAdding] = React.useState(false);
  const [passkeyName, setPasskeyName] = React.useState("");
  const [passkeyError, setPasskeyError] = React.useState<string | null>(null);
  const lastAction = React.useRef<typeof actionData>(undefined);

  React.useEffect(() => {
    if (actionData && actionData !== lastAction.current) {
      lastAction.current = actionData;
      toast(actionData.message, { tone: "success" });
    }
  }, [actionData]);

  async function addPasskey() {
    setAdding(true);
    setPasskeyError(null);
    const result = await authClient.passkey.addPasskey({ name: passkeyName.trim() || undefined });
    setAdding(false);
    if (result?.error) {
      setPasskeyError(
        "The passkey wasn't added. Your device may not support passkeys, or the request was cancelled.",
      );
      return;
    }
    setPasskeyName("");
    toast("Passkey added. Next time, sign in with Face ID or Touch ID.", { tone: "success" });
    revalidator.revalidate();
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Account"
        description={`Signed in as ${loaderData.user.name} (${loaderData.user.email}).`}
      />

      <Card>
        <CardHeader>
          <CardTitle>Passkeys</CardTitle>
          <CardDescription>
            Sign in with Face ID, Touch ID or your device PIN instead of an email link.
          </CardDescription>
        </CardHeader>
        {loaderData.passkeys.length > 0 && (
          <ul className="mb-4 divide-y divide-border">
            {loaderData.passkeys.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2">
                <Fingerprint className="size-5 text-sage-base" aria-hidden />
                <span className="flex-1">
                  {p.name}
                  {p.createdAt && (
                    <span className="block text-label font-normal text-secondary">Added {p.createdAt}</span>
                  )}
                </span>
                <ConfirmDelete
                  iconOnly
                  label={`Remove ${p.name}`}
                  title={`Remove the passkey ${p.name}?`}
                  description="You won't be able to sign in with it any more. You can still sign in with an email link."
                  confirmLabel="Remove passkey"
                  fields={{ intent: "delete-passkey", id: p.id }}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-3 tablet:flex-row tablet:items-end">
          <TextField
            label="Name this passkey"
            value={passkeyName}
            onChange={(e) => setPasskeyName(e.target.value)}
            placeholder="e.g. My iPad"
            fieldClassName="flex-1"
          />
          <Button type="button" onClick={addPasskey} loading={adding}>
            {!adding && <Fingerprint aria-hidden />}
            Add a passkey
          </Button>
        </div>
        {passkeyError && (
          <p role="alert" className="mt-2 text-label font-semibold text-danger-ink">
            {passkeyError}
          </p>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Signed-in devices</CardTitle>
          <CardDescription>Sessions last 30 days and renew while you use the app.</CardDescription>
        </CardHeader>
        <ul className="divide-y divide-border">
          {loaderData.sessions.map((s) => (
            <li key={s.token} className="flex items-center gap-3 py-3">
              {s.phone ? (
                <Smartphone className="size-5 text-secondary" aria-hidden />
              ) : (
                <Monitor className="size-5 text-secondary" aria-hidden />
              )}
              <span className="flex-1">
                <span className="font-semibold">{s.label}</span>
                {s.current && (
                  <span className="ml-2 rounded-full bg-sage-tint px-2 py-0.5 text-micro font-semibold text-sage-ink">
                    This device
                  </span>
                )}
                <span className="block text-label font-normal text-secondary">
                  Last active {s.lastActive}
                </span>
              </span>
              {!s.current && (
                <Form method="post">
                  <input type="hidden" name="intent" value="revoke" />
                  <input type="hidden" name="token" value={s.token} />
                  <Button
                    type="submit"
                    variant="secondary"
                    loading={pending === "revoke" && pendingToken === s.token}
                  >
                    Sign out
                  </Button>
                </Form>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-col gap-2 tablet:flex-row">
          {loaderData.sessions.length > 1 && (
            <Form method="post">
              <input type="hidden" name="intent" value="revoke-others" />
              <Button type="submit" variant="secondary" loading={pending === "revoke-others"}>
                Sign out other devices
              </Button>
            </Form>
          )}
          <Form method="post">
            <input type="hidden" name="intent" value="revoke-all" />
            <Button type="submit" variant="destructive" loading={pending === "revoke-all"}>
              {pending !== "revoke-all" && <LogOut aria-hidden />}
              Sign out everywhere
            </Button>
          </Form>
        </div>
      </Card>
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
