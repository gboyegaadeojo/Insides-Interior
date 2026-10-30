import { describe, expect, it } from "vitest";
import { b64url, encryptPayload, fromB64url, vapidJwt } from "~/server/push";

const encoder = new TextEncoder();

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
      key,
      length * 8,
    ),
  );
}

/** Decrypts as the browser does (RFC 8291 §3), to prove the round trip. */
async function decrypt(body: Uint8Array, receiver: CryptoKeyPair, authSecret: Uint8Array) {
  const salt = body.slice(0, 16);
  const idLength = body[20]!;
  const asPublic = body.slice(21, 21 + idLength);
  const ciphertext = body.slice(21 + idLength);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", receiver.publicKey));
  const senderKey = await crypto.subtle.importKey(
    "raw",
    asPublic as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: senderKey }, receiver.privateKey, 256),
  );
  const info = new Uint8Array([...encoder.encode("WebPush: info\0"), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(authSecret, shared, info, 32);
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce as BufferSource },
      key,
      ciphertext as BufferSource,
    ),
  );
  expect(plain.at(-1)).toBe(2); // last-record delimiter
  return new TextDecoder().decode(plain.slice(0, -1));
}

describe("Web Push (owner request: device alerts)", () => {
  it("round-trips base64url", () => {
    const bytes = new Uint8Array([0, 250, 251, 252, 253, 254, 255]);
    expect(fromB64url(b64url(bytes))).toEqual(bytes);
    expect(b64url(bytes)).not.toMatch(/[+/=]/);
  });

  it("encrypts a payload the browser can decrypt (aes128gcm, RFC 8291)", async () => {
    const receiver = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;
    const p256dh = b64url(new Uint8Array(await crypto.subtle.exportKey("raw", receiver.publicKey)));
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const message = JSON.stringify({ title: "Adaeze approved Q-1061", url: "/quotes/qte_1" });
    const body = await encryptPayload({ p256dh, auth: b64url(auth) }, encoder.encode(message));
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
    expect(body[20]).toBe(65);
    expect(await decrypt(body, receiver, auth)).toBe(message);
  });

  it("signs a VAPID token the public key verifies", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const jwt = await vapidJwt(jwk, "https://fcm.googleapis.com", "https://example.ng", 1_800_000_000_000);
    const [header, claims, signature] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(new TextDecoder().decode(fromB64url(claims)))).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: 1_800_000_000 + 12 * 3600,
      sub: "https://example.ng",
    });
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pair.publicKey,
      fromB64url(signature) as BufferSource,
      encoder.encode(`${header}.${claims}`),
    );
    expect(ok).toBe(true);
  });
});
