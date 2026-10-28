// Better Auth (SPEC 5.1, 11): magic link via the email interface, Google when
// configured, passkeys. No registration: only existing, enabled users (the
// seeded owner and invited staff) can sign in. Sessions last 30 days with
// sliding renewal; cookies are HttpOnly, Secure and SameSite=Lax.

import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins/magic-link";
import { eq } from "drizzle-orm";
import { type IdPrefix, newId } from "~/lib/ids";
import { getDb, schema } from "./db";
import { sendEmail } from "./email";
import { signInEmail } from "./email/templates";
import { allowedOrigins, resolveOrigin } from "./origins";

export const MAGIC_LINK_TTL_SECONDS = 15 * 60;
const THIRTY_DAYS = 60 * 60 * 24 * 30;

const ID_PREFIX: Record<string, IdPrefix> = {
  user: "usr",
};

export interface AuthOptions {
  /** Test hook (E2E only): receive the magic link instead of emailing it. */
  onMagicLink?: (url: string) => void;
  /** Mark the next magic link email as an invitation. */
  invite?: { name?: string };
}

export function createAuth(env: Env, request: Request, options: AuthOptions = {}) {
  const db = getDb(env);
  const origin = resolveOrigin(env, request);
  const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

  return betterAuth({
    appName: "Insides Interior",
    baseURL: origin,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [origin, ...allowedOrigins(env)],
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        passkey: schema.passkey,
      },
    }),
    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "staff", input: false },
        businessId: { type: "string", required: false, input: false },
        disabledAt: { type: "string", required: false, input: false },
      },
    },
    session: {
      expiresIn: THIRTY_DAYS,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    emailAndPassword: { enabled: false },
    socialProviders: googleEnabled
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            disableSignUp: true,
            prompt: "select_account",
          },
        }
      : {},
    account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_TTL_SECONDS,
        disableSignUp: true,
        storeToken: "hashed",
        async sendMagicLink({ email, url }) {
          if (options.onMagicLink) {
            options.onMagicLink(url);
            return;
          }
          const [business] = await db.select().from(schema.business).limit(1);
          const [member] = await db.select().from(schema.user).where(eq(schema.user.email, email)).limit(1);
          const brand = {
            name: business?.tradingName || business?.legalName || "Insides Interior",
            brandColor: business?.brandColor ?? "#0F766E",
          };
          const rendered = signInEmail(brand, url, {
            invited: Boolean(options.invite),
            name: options.invite?.name ?? member?.name,
          });
          await sendEmail(env, { to: email, ...rendered });
          if (business) {
            // Sign-in emails are logged without their link (SPEC 11.1: never store tokens).
            await db.insert(schema.emailMessage).values({
              id: newId("eml"),
              businessId: business.id,
              template: options.invite ? "invite" : "sign_in",
              to: email,
              subject: rendered.subject,
              transport: env.RESEND_API_KEY ? "resend" : "dev",
              status: "sent",
            });
          }
        },
      }),
      passkey({
        rpID: new URL(origin).hostname,
        rpName: "Insides Interior",
        origin,
      }),
    ],
    databaseHooks: {
      session: {
        create: {
          // Disabled accounts can't start a session, whichever method they use.
          async before(session) {
            const [member] = await db
              .select()
              .from(schema.user)
              .where(eq(schema.user.id, session.userId))
              .limit(1);
            if (!member || member.disabledAt) return false;
            return { data: session };
          },
        },
      },
    },
    advanced: {
      cookiePrefix: "ii",
      useSecureCookies: origin.startsWith("https://"),
      database: {
        generateId: ({ model }) => (ID_PREFIX[model] ? newId(ID_PREFIX[model]!) : crypto.randomUUID()),
      },
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    rateLimit: {
      // Production only: local, test and preview runs share one address and
      // sign in many times a minute (Playwright, integration tests).
      enabled: env.APP_ENV === "production",
      window: 60,
      max: 30,
      customRules: { "/sign-in/magic-link": { window: 60, max: 5 } },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export const isGoogleEnabled = (env: Env) => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
