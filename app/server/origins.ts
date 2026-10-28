/** Origins allowed to serve the app and sign in: APP_URL plus TRUSTED_ORIGINS (comma list, `*` wildcards). */
export function allowedOrigins(env: Pick<Env, "APP_URL" | "TRUSTED_ORIGINS">): string[] {
  return [env.APP_URL, ...env.TRUSTED_ORIGINS.split(",")].map((o) => o.trim()).filter(Boolean);
}

export function originMatches(origin: string, pattern: string): boolean {
  if (!pattern.includes("*")) return origin === pattern;
  const regex = new RegExp(
    `^${pattern
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[a-z0-9-]+")}$`,
  );
  return regex.test(origin);
}

/** The request's own origin when allowed, otherwise APP_URL. */
export function resolveOrigin(
  env: Pick<Env, "APP_URL" | "TRUSTED_ORIGINS" | "APP_ENV">,
  request: Request,
): string {
  const origin = new URL(request.url).origin;
  if (env.APP_ENV === "development" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
    return origin;
  return allowedOrigins(env).some((pattern) => originMatches(origin, pattern)) ? origin : env.APP_URL;
}
