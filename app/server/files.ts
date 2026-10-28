// Private R2 files (SPEC 11.1): receipts, photos and covers are served only
// through short-lived signed URLs (10 minutes), signed with HMAC-SHA-256.

const TTL_SECONDS = 10 * 60;
const encoder = new TextEncoder();

async function hmac(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** `/files/<key>?exp=…&sig=…`, valid for 10 minutes (rounded so pages cache well). */
export async function signedFileUrl(env: Pick<Env, "BETTER_AUTH_SECRET">, key: string, now = Date.now()) {
  // Round expiry up to the next minute so the same file gets the same URL for a while.
  const exp = Math.ceil((now / 1000 + TTL_SECONDS) / 60) * 60;
  const sig = await hmac(env.BETTER_AUTH_SECRET, `${key}:${exp}`);
  return `/files/${key.split("/").map(encodeURIComponent).join("/")}?exp=${exp}&sig=${sig}`;
}

export async function verifyFileSignature(
  env: Pick<Env, "BETTER_AUTH_SECRET">,
  key: string,
  exp: string | null,
  sig: string | null,
  now = Date.now(),
) {
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) * 1000 < now) return false;
  const expected = await hmac(env.BETTER_AUTH_SECRET, `${key}:${exp}`);
  // Constant-time comparison.
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

export const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
