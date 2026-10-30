// Web Push (owner request: alerts on iPhone, Android and desktop). Payloads are
// encrypted with aes128gcm (RFC 8291) and requests signed with VAPID (RFC 8292),
// using only WebCrypto, so no library and little CPU. Keys: VAPID_PUBLIC_KEY
// (var, base64url uncompressed P-256 point) and VAPID_PRIVATE_KEY (secret, JWK).

const encoder = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function fromB64url(text: string): Uint8Array {
  const padded = text.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

export interface PushTarget {
  endpoint: string;
  /** Base64url uncompressed P-256 public key of the browser (65 bytes). */
  p256dh: string;
  /** Base64url 16-byte auth secret. */
  auth: string;
}

/**
 * RFC 8291 aes128gcm body: salt(16) · record size(4) · key id length(1) ·
 * our ephemeral public key(65) · ciphertext of payload ‖ 0x02.
 */
export async function encryptPayload(
  target: Pick<PushTarget, "p256dh" | "auth">,
  payload: Uint8Array,
  opts: { salt?: Uint8Array; ephemeral?: CryptoKeyPair } = {},
): Promise<Uint8Array> {
  const uaPublic = fromB64url(target.p256dh);
  const authSecret = fromB64url(target.auth);
  const ephemeral =
    opts.ephemeral ??
    ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));
  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, ephemeral.privateKey, 256),
  );
  const keyInfo = concat(encoder.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource },
      aes,
      concat(payload, new Uint8Array([2])) as BufferSource,
    ),
  );
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, ciphertext);
}

/** VAPID JWT (ES256) for the push service's origin, valid 12 hours. */
export async function vapidJwt(privateJwk: JsonWebKey, audience: string, subject: string, now = Date.now()) {
  const key = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = b64url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(
    encoder.encode(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })),
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(`${header}.${claims}`)),
  );
  return `${header}.${claims}.${b64url(signature)}`;
}

export interface PushMessage {
  title: string;
  body?: string;
  /** Opened when the alert is tapped (path in the app). */
  url: string;
  /** Alerts with the same tag replace each other on the device. */
  tag?: string;
}

export type PushResult = "sent" | "gone" | "failed";

/** Sends one alert. "gone" means the browser unsubscribed: delete the row. */
export async function sendPush(
  env: Pick<Env, "VAPID_PUBLIC_KEY" | "VAPID_PRIVATE_KEY" | "APP_URL">,
  target: PushTarget,
  message: PushMessage,
): Promise<PushResult> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return "failed";
  const body = await encryptPayload(target, encoder.encode(JSON.stringify(message)));
  const jwt = await vapidJwt(
    JSON.parse(env.VAPID_PRIVATE_KEY) as JsonWebKey,
    new URL(target.endpoint).origin,
    env.APP_URL,
  );
  const response = await fetch(target.endpoint, {
    method: "POST",
    headers: {
      TTL: "86400",
      Urgency: "high",
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      ...(message.tag ? { Topic: message.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) } : {}),
    },
    body: body as BodyInit,
  });
  if (response.status === 404 || response.status === 410) return "gone";
  if (!response.ok) {
    console.error("push failed", response.status, (await response.text()).slice(0, 200));
    return "failed";
  }
  return "sent";
}
