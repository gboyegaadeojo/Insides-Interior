// Resend webhook signatures (SPEC 9.3 step 4, 11.1): Svix scheme. The signed
// content is "<svix-id>.<svix-timestamp>.<raw body>", HMAC-SHA-256 with the
// base64 secret after "whsec_"; the header carries one or more "v1,<base64>".
// Requests older (or newer) than 5 minutes are rejected to stop replays.

const TOLERANCE_SECONDS = 5 * 60;
const encoder = new TextEncoder();

export type SvixResult = { ok: true } | { ok: false; reason: string };

export async function verifySvix(
  secret: string,
  headers: Headers,
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<SvixResult> {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (!id || !timestamp || !signatures) return { ok: false, reason: "missing headers" };
  if (!/^\d+$/.test(timestamp)) return { ok: false, reason: "bad timestamp" };
  if (Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS) return { ok: false, reason: "stale" };

  let keyBytes: Uint8Array<ArrayBuffer>;
  try {
    keyBytes = Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (c) => c.charCodeAt(0));
  } catch {
    return { ok: false, reason: "bad secret" };
  }
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${id}.${timestamp}.${body}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  for (const part of signatures.split(" ")) {
    const [version, signature] = part.split(",", 2);
    if (version === "v1" && signature && constantTimeEqual(signature, expected)) return { ok: true };
  }
  return { ok: false, reason: "no matching signature" };
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
