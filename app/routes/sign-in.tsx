import { Fingerprint, Mail, MailCheck } from "lucide-react";
import * as React from "react";
import { data, Form, redirect, useNavigation } from "react-router";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { TextField } from "~/components/ui/field";
import { authClient } from "~/lib/auth-client";
import { cn } from "~/lib/utils";
import { createAuth, isGoogleEnabled } from "~/server/auth";
import { getDb, schema } from "~/server/db";
import { getUser } from "~/server/session";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/sign-in";

// Sign-in (FR-AUTH-01/06, SPEC 6.8). No registration and no password, so there
// is no "Forgot password" or "Create account" link.

export function meta() {
  return [{ title: "Sign in · Insides Interior" }];
}

/** Only same-site paths are allowed as the post-sign-in destination. */
function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/api/")
    ? value
    : "/";
}

const ERRORS: Record<string, string> = {
  EXPIRED_TOKEN: "That sign-in link has expired. Links work for 15 minutes; send yourself a new one.",
  INVALID_TOKEN: "That sign-in link has already been used or isn't valid. Send yourself a new one.",
  ATTEMPTS_EXCEEDED: "That sign-in link has already been used. Send yourself a new one.",
  new_user_signup_disabled: "That account isn't invited. Ask the owner to add you.",
  signup_disabled: "That Google account isn't invited. Use the email address the owner invited.",
  unable_to_create_session: "Your access has been turned off. Ask the owner if this is a mistake.",
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const url = new URL(request.url);
  if (await getUser(env, request)) throw redirect(safeNext(url.searchParams.get("next")));
  const db = getDb(env);
  const [business] = await db.select().from(schema.business).limit(1);
  const errorCode = url.searchParams.get("error");
  return {
    next: safeNext(url.searchParams.get("next")),
    google: isGoogleEnabled(env),
    businessName: business?.tradingName || business?.legalName || "Insides Interior",
    error: errorCode
      ? (ERRORS[errorCode] ?? "We couldn't sign you in with that link. Send yourself a new one.")
      : null,
    devEmail: env.APP_ENV === "development" && !env.RESEND_API_KEY,
  };
}

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter the email address you were invited with")),
});

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const form = await request.formData();
  const next = safeNext(String(form.get("next") ?? "/"));
  const auth = createAuth(env, request);

  if (form.get("intent") === "google") {
    if (!isGoogleEnabled(env))
      return data({ error: "Google sign-in isn't set up yet.", sent: null }, { status: 400 });
    const { headers, response } = await auth.api.signInSocial({
      body: { provider: "google", callbackURL: next, errorCallbackURL: "/sign-in" },
      headers: request.headers,
      returnHeaders: true,
    });
    if (!response?.url)
      return data(
        { error: "Google sign-in is unavailable right now. Try email instead.", sent: null },
        { status: 503 },
      );
    return redirect(response.url, { headers });
  }

  const parsed = emailSchema.safeParse({ email: form.get("email") });
  if (!parsed.success) return data({ error: parsed.error.issues[0]!.message, sent: null }, { status: 400 });
  const email = parsed.data.email;

  // FR-AUTH-06: say plainly when an address isn't invited (owner request).
  const db = getDb(env);
  const [member] = await db.select().from(schema.user).where(eq(schema.user.email, email)).limit(1);
  if (!member)
    return data(
      { error: "That email isn't invited. Ask the owner to add you.", sent: null },
      { status: 403 },
    );
  if (member.disabledAt)
    return data(
      { error: "Your access has been turned off. Ask the owner if this is a mistake.", sent: null },
      { status: 403 },
    );

  try {
    await auth.api.signInMagicLink({
      body: { email, callbackURL: next, errorCallbackURL: "/sign-in" },
      headers: request.headers,
    });
  } catch (error) {
    console.error("magic link send failed", error);
    return data(
      { error: "We couldn't send the email just now. Try again in a minute.", sent: null },
      { status: 503 },
    );
  }
  return { error: null, sent: email };
}

export default function SignIn({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const busyIntent = navigation.state !== "idle" ? navigation.formData?.get("intent") : null;
  const [passkeyAvailable, setPasskeyAvailable] = React.useState(false);
  const [passkeyError, setPasskeyError] = React.useState<string | null>(null);
  const [passkeyBusy, setPasskeyBusy] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const check = window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.();
    check?.then((ok) => !cancelled && setPasskeyAvailable(ok)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function signInWithPasskey() {
    setPasskeyBusy(true);
    setPasskeyError(null);
    const result = await authClient.signIn.passkey();
    if (result?.error) {
      setPasskeyError(
        "That passkey didn't work. Use your email link instead, then add a passkey in Settings.",
      );
      setPasskeyBusy(false);
      return;
    }
    window.location.assign(loaderData.next);
  }

  const error = actionData?.error ?? loaderData.error;
  const sent = actionData?.sent;

  return (
    <main
      data-module="home"
      className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-teal-tint via-canvas to-plum-tint px-4 py-10 pt-safe pb-safe"
    >
      <div className="w-full max-w-md rounded-sheet border border-border bg-surface p-6 shadow-sheet tablet:p-8">
        <div className="mb-6 flex items-center gap-3">
          <span
            className="inline-flex size-12 items-center justify-center rounded-card bg-teal-base font-display text-title text-teal-on"
            aria-hidden
          >
            I
          </span>
          <span className="font-display text-section">{loaderData.businessName}</span>
        </div>

        {sent ? (
          <div role="status" aria-live="polite">
            <MailCheck className="mb-3 size-10 text-teal-base" aria-hidden />
            <h1 className="font-display text-title">Check your email</h1>
            <p className="mt-2 text-secondary">
              We sent a sign-in link to <strong className="text-primary">{sent}</strong>. It works once and
              expires in 15 minutes.
            </p>
            {loaderData.devEmail && (
              <p className="mt-3 rounded-control bg-saffron-tint p-3 text-label font-normal text-saffron-ink">
                Development: email isn't sent. The link is printed in the terminal running{" "}
                <code>npm run dev</code>.
              </p>
            )}
            <Form method="post" className="mt-6">
              <input type="hidden" name="email" value={sent} />
              <input type="hidden" name="next" value={loaderData.next} />
              <Button
                type="submit"
                variant="secondary"
                className="w-full"
                loading={busyIntent === "email"}
                name="intent"
                value="email"
              >
                Send another link
              </Button>
            </Form>
          </div>
        ) : (
          <>
            <h1 className="font-display text-display">Sign in</h1>
            <p className="mt-1 text-secondary">We'll email you a link. No password needed.</p>

            {error && (
              <p
                role="alert"
                className="mt-4 rounded-control border border-danger-base bg-danger-tint p-3 font-semibold text-danger-ink"
              >
                {error}
              </p>
            )}

            <Form method="post" className="mt-6 flex flex-col gap-4">
              <input type="hidden" name="next" value={loaderData.next} />
              <TextField
                label="Email"
                name="email"
                type="email"
                autoComplete="email webauthn"
                inputMode="email"
                required
                autoFocus
              />
              <Button
                type="submit"
                size="lg"
                name="intent"
                value="email"
                loading={busyIntent === "email"}
                disabled={Boolean(busyIntent)}
              >
                {busyIntent !== "email" && <Mail aria-hidden />}
                Email me a sign-in link
              </Button>
            </Form>

            {(loaderData.google || passkeyAvailable) && (
              <div className="my-5 flex items-center gap-3 text-label text-secondary" aria-hidden>
                <span className="h-px flex-1 bg-border" />
                or
                <span className="h-px flex-1 bg-border" />
              </div>
            )}

            <div className="flex flex-col gap-3">
              {loaderData.google && (
                <Form method="post">
                  <input type="hidden" name="next" value={loaderData.next} />
                  <Button
                    type="submit"
                    variant="secondary"
                    size="lg"
                    className="w-full"
                    name="intent"
                    value="google"
                    loading={busyIntent === "google"}
                    disabled={Boolean(busyIntent)}
                  >
                    {busyIntent !== "google" && <GoogleMark />}
                    Continue with Google
                  </Button>
                </Form>
              )}
              {passkeyAvailable && (
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  onClick={signInWithPasskey}
                  loading={passkeyBusy}
                  disabled={Boolean(busyIntent)}
                >
                  {!passkeyBusy && <Fingerprint aria-hidden />}
                  Sign in with a passkey
                </Button>
              )}
              {passkeyError && (
                <p role="alert" className={cn("text-label font-semibold text-danger-ink")}>
                  {passkeyError}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function GoogleMark() {
  // Google "G" outline in the current text colour (no brand colours in-app, DS-COL-01).
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-5">
      <path
        fill="currentColor"
        d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.66 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.96S8.78 6.26 12 6.26c1.83 0 3.06.78 3.76 1.45l2.57-2.47C16.68 3.7 14.55 2.75 12 2.75 6.9 2.75 2.75 6.9 2.75 12s4.15 9.25 9.25 9.25c5.34 0 8.88-3.75 8.88-9.04 0-.6-.07-1.06-.15-1.51Z"
      />
    </svg>
  );
}
