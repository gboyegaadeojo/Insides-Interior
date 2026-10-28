import { describe, expect, it } from "vitest";
import { accessibleBrandColor, normaliseHex } from "~/lib/brand";
import { renderMergeFields, unknownMergeFields } from "~/lib/merge-fields";
import { contrast } from "~/styles/tokens";

describe("brand colour (FR-SET-09)", () => {
  it("normalises hex input", () => {
    expect(normaliseHex("0f766e")).toBe("#0F766E");
    expect(normaliseHex("#abc")).toBe("#AABBCC");
    expect(normaliseHex("teal")).toBeNull();
  });

  it("accepts colours that pass AA on white", () => {
    expect(accessibleBrandColor("#0F766E")).toMatchObject({ ok: true, suggestion: "#0F766E" });
  });

  it("suggests the nearest darker accessible shade", () => {
    const result = accessibleBrandColor("#F2C94C");
    expect(result.ok).toBe(false);
    expect(contrast(result.suggestion, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    // Nearest: one step lighter would fail.
    expect(result.suggestion).not.toBe("#000000");
  });
});

describe("merge fields (FR-SET-07)", () => {
  it("fills known fields and leaves unknown ones visible", () => {
    expect(
      renderMergeFields("Hi {client.firstName}, {invoice.number} {nope}", {
        "client.firstName": "Amelia",
        "invoice.number": "INV-1",
      }),
    ).toBe("Hi Amelia, INV-1 {nope}");
  });

  it("lists unknown fields", () => {
    expect(unknownMergeFields("{link} {client.lastName} {amount.due}")).toEqual(["client.lastName"]);
  });
});
