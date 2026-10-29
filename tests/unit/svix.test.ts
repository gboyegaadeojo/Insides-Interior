import { describe, expect, it } from "vitest";
import { verifySvix } from "~/server/svix";

const SECRET = `whsec_${btoa("unit-test-webhook-secret")}`;
const BODY = JSON.stringify({ type: "email.delivered", data: { email_id: "re_1" } });
const NOW = 1_800_000_000;

async function sign(id: string, timestamp: number, body: string, secret = SECRET) {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(secret.slice(6)), (c) => c.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

function headers(id: string, timestamp: number | string, signature: string) {
  return new Headers({ "svix-id": id, "svix-timestamp": String(timestamp), "svix-signature": signature });
}

describe("Svix webhook verification (SPEC 9.3, 11.1)", () => {
  it("accepts a correct v1 signature among several", async () => {
    const sig = await sign("msg_1", NOW, BODY);
    const result = await verifySvix(SECRET, headers("msg_1", NOW, `v1,bm9wZQ== v1,${sig}`), BODY, NOW);
    expect(result).toEqual({ ok: true });
  });

  it("rejects a tampered body, a wrong secret and a missing header", async () => {
    const sig = await sign("msg_1", NOW, BODY);
    expect((await verifySvix(SECRET, headers("msg_1", NOW, `v1,${sig}`), `${BODY} `, NOW)).ok).toBe(false);
    const other = `whsec_${btoa("another-secret")}`;
    expect((await verifySvix(other, headers("msg_1", NOW, `v1,${sig}`), BODY, NOW)).ok).toBe(false);
    expect(await verifySvix(SECRET, new Headers(), BODY, NOW)).toEqual({
      ok: false,
      reason: "missing headers",
    });
    expect(await verifySvix(SECRET, headers("msg_1", NOW, `v2,${sig}`), BODY, NOW)).toEqual({
      ok: false,
      reason: "no matching signature",
    });
  });

  it("rejects events more than 5 minutes old or ahead, and junk timestamps", async () => {
    const old = NOW - 301;
    const sig = await sign("msg_1", old, BODY);
    expect(await verifySvix(SECRET, headers("msg_1", old, `v1,${sig}`), BODY, NOW)).toEqual({
      ok: false,
      reason: "stale",
    });
    expect((await verifySvix(SECRET, headers("msg_1", NOW + 301, "v1,x"), BODY, NOW)).ok).toBe(false);
    expect(await verifySvix(SECRET, headers("msg_1", "soon", "v1,x"), BODY, NOW)).toEqual({
      ok: false,
      reason: "bad timestamp",
    });
  });

  it("reports a malformed secret instead of throwing", async () => {
    expect(await verifySvix("whsec_%%%", headers("msg_1", NOW, "v1,x"), BODY, NOW)).toEqual({
      ok: false,
      reason: "bad secret",
    });
  });
});
