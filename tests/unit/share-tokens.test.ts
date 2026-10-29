import { describe, expect, it } from "vitest";
import { redactPortalTokens } from "~/server/email/dev-transport";
import { hashShareToken, looksLikeShareToken, newShareSalt, portalPath, shareToken } from "~/server/tokens";

const SECRET = "unit-test-secret-unit-test-secret";

describe("share tokens (SPEC 8.4)", () => {
  it("are 43-character base64url strings, stable for the same salt and new for a new salt", async () => {
    const salt = newShareSalt();
    const a = await shareToken(SECRET, "quote", "qte_1", salt);
    expect(looksLikeShareToken(a)).toBe(true);
    expect(await shareToken(SECRET, "quote", "qte_1", salt)).toBe(a);
    expect(await shareToken(SECRET, "quote", "qte_1", newShareSalt())).not.toBe(a);
    expect(await shareToken(SECRET, "invoice", "qte_1", salt)).not.toBe(a);
    expect(await shareToken(`${SECRET}x`, "quote", "qte_1", salt)).not.toBe(a);
  });

  it("are stored only as a SHA-256 hash", async () => {
    const token = await shareToken(SECRET, "quote", "qte_1", "salt");
    const hash = await hashShareToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });

  it("rejects anything that isn't token-shaped before a lookup", () => {
    expect(looksLikeShareToken(undefined)).toBe(false);
    expect(looksLikeShareToken("abc")).toBe(false);
    expect(looksLikeShareToken(`${"a".repeat(42)}!`)).toBe(false);
  });

  it("builds portal paths and never logs them outside development", async () => {
    const token = await shareToken(SECRET, "quote", "qte_1", "salt");
    expect(portalPath("quote", token)).toBe(`/q/${token}`);
    expect(portalPath("invoice", token)).toBe(`/i/${token}`);
    expect(redactPortalTokens(`https://app.example.ng/q/${token}?print=1`)).toBe(
      "https://app.example.ng/q/[token hidden]?print=1",
    );
  });
});
