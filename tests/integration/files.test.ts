import { describe, expect, it } from "vitest";
import { signedFileUrl, verifyFileSignature } from "~/server/files";
import { testEnv } from "./helpers";

describe("signed file URLs (SPEC 11.1)", () => {
  it("verify for 10 minutes, then expire", async () => {
    const now = Date.UTC(2026, 9, 28, 12, 0, 0);
    const url = new URL(await signedFileUrl(testEnv, "items/itm_1/photo.jpg", now), "https://x");
    const exp = url.searchParams.get("exp");
    const sig = url.searchParams.get("sig");
    expect(url.pathname).toBe("/files/items/itm_1/photo.jpg");
    expect(await verifyFileSignature(testEnv, "items/itm_1/photo.jpg", exp, sig, now + 9 * 60_000)).toBe(
      true,
    );
    expect(await verifyFileSignature(testEnv, "items/itm_1/photo.jpg", exp, sig, now + 12 * 60_000)).toBe(
      false,
    );
  });

  it("reject another key, a tampered signature or missing parts", async () => {
    const now = Date.now();
    const url = new URL(await signedFileUrl(testEnv, "items/a.jpg", now), "https://x");
    const exp = url.searchParams.get("exp");
    const sig = url.searchParams.get("sig")!;
    expect(await verifyFileSignature(testEnv, "items/b.jpg", exp, sig, now)).toBe(false);
    expect(await verifyFileSignature(testEnv, "items/a.jpg", exp, sig.replace(/.$/, "x"), now)).toBe(false);
    expect(await verifyFileSignature(testEnv, "items/a.jpg", null, sig, now)).toBe(false);
  });
});
