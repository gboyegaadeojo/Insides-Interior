// Portal share tokens (SPEC 8.4, docs/decisions.md phase 5). A token is
// HMAC-SHA-256(server secret, "share:<entity>:<id>:<salt>"): 32 bytes,
// base64url, 43 characters. Only its SHA-256 hash is stored and looked up; the
// random salt lives on the row and changes to rotate or revoke the link. The
// server can rebuild the link (Copy link, PDF rendering) but the database alone
// can't, because the secret lives in a Wrangler secret. Never log a token.

const encoder = new TextEncoder();

export type ShareEntity = "quote" | "invoice";

function base64url(bytes: ArrayBuffer | Uint8Array) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

let cached: { secret: string; key: Promise<CryptoKey> } | undefined;

function signingKey(secret: string) {
  if (cached?.secret !== secret) {
    const key = crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    cached = { secret, key };
  }
  return cached.key;
}

/** 16 random bytes, base64url: changing it rotates the link. */
export function newShareSalt(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

export async function shareToken(secret: string, entity: ShareEntity, id: string, salt: string) {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret),
    encoder.encode(`share:${entity}:${id}:${salt}`),
  );
  return base64url(signature);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** What is stored in `share_token_hash` and looked up on every portal request. */
export function hashShareToken(token: string): Promise<string> {
  return sha256Hex(token);
}

/** A 43-character base64url string; anything else is rejected before touching the database. */
export function looksLikeShareToken(token: string | undefined): token is string {
  return !!token && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function portalPath(entity: ShareEntity, token: string) {
  return `/${entity === "quote" ? "q" : "i"}/${token}`;
}
