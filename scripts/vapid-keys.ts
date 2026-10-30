// Prints a new Web Push (VAPID) key pair. Put the public key in wrangler.jsonc
// (VAPID_PUBLIC_KEY) and the private one in a secret:
//   node scripts/vapid-keys.ts
//   npx wrangler secret put VAPID_PRIVATE_KEY          (paste the JWK line)
// Changing the pair means every device has to turn alerts on again.

const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
])) as CryptoKeyPair;
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const publicKey = Buffer.from(raw).toString("base64url");
const privateJwk = JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey));
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateJwk}`);

export {};
