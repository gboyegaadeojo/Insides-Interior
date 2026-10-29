import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonicalJson, type Json } from "~/domain/canonical";
import { computeContent, type ContentForTotals } from "~/domain/document";
import {
  applySelection,
  isPastValidUntil,
  optionIds,
  selectedOptionIds,
  signatureSvg,
  validateSignerName,
} from "~/domain/portal";

describe("canonicalJson", () => {
  it("sorts keys at every depth and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: true, y: null }], c: "x" }, u: undefined })).toBe(
      '{"a":{"c":"x","d":[1,{"y":null,"z":true}]},"b":1}',
    );
  });

  it("writes top-level undefined as null and refuses non-finite numbers", () => {
    expect(canonicalJson(undefined)).toBe("null");
    expect(canonicalJson([undefined as unknown as Json])).toBe("[null]");
    expect(() => canonicalJson(Number.NaN)).toThrow("non-finite");
  });

  it("is independent of key order (property)", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.oneof(fc.integer(), fc.string(), fc.boolean())), (obj) => {
        const reversed = Object.fromEntries(Object.entries(obj).reverse());
        expect(canonicalJson(reversed)).toBe(canonicalJson(obj));
      }),
    );
  });
});

const content: ContentForTotals = {
  taxRates: [{ id: "vat", name: "VAT", rateBp: 750 }],
  sections: [
    {
      id: "s1",
      title: "Living room",
      lines: [
        {
          id: "a",
          description: "Sofa",
          qtyMilli: 1000,
          unit: "each",
          unitPriceCents: 100_000,
          taxRateIds: [],
        },
        {
          id: "o1",
          description: "Cushions",
          qtyMilli: 2000,
          unit: "each",
          unitPriceCents: 5_000,
          taxRateIds: [],
          optional: true,
          selected: true,
        },
        {
          id: "o2",
          description: "Throw",
          qtyMilli: 1000,
          unit: "each",
          unitPriceCents: 7_500,
          taxRateIds: [],
          optional: true,
        },
      ],
    },
  ],
};

describe("option selection (FR-QT-03)", () => {
  it("lists optional and selected lines", () => {
    expect(optionIds(content)).toEqual(["o1", "o2"]);
    expect(selectedOptionIds(content)).toEqual(["o1"]);
  });

  it("applies the client's choices and the server total follows", () => {
    const chosen = applySelection(content, ["o2"]);
    expect(selectedOptionIds(chosen)).toEqual(["o2"]);
    expect(computeContent(chosen).computed.totalCents).toBe(107_500);
    expect(computeContent(applySelection(content, [])).computed.totalCents).toBe(100_000);
  });

  it("ignores ids that aren't optional lines, so a regular line can't be switched off", () => {
    const chosen = applySelection(content, ["a", "nope"]);
    expect(chosen.sections[0]!.lines[0]).toEqual(content.sections[0]!.lines[0]);
    expect(computeContent(chosen).computed.totalCents).toBe(100_000);
  });
});

describe("expiry (FR-QT-11)", () => {
  it("expires the day after valid-until, never without a date", () => {
    expect(isPastValidUntil("2026-10-28", "2026-10-28")).toBe(false);
    expect(isPastValidUntil("2026-10-28", "2026-10-29")).toBe(true);
    expect(isPastValidUntil(null, "2026-10-29")).toBe(false);
  });
});

describe("signature (FR-QT-15)", () => {
  it("builds SVG from integer strokes inside the box", () => {
    const svg = signatureSvg([
      [10, 20, 30, 40],
      [500, 100, 510, 110, 520, 90],
    ]);
    expect(svg).toContain('viewBox="0 0 1000 300"');
    expect(svg).toContain('d="M10 20L30 40M500 100L510 110L520 90"');
  });

  it("rejects anything that isn't clean strokes", () => {
    expect(signatureSvg(null)).toBeNull();
    expect(signatureSvg([])).toBeNull();
    expect(signatureSvg([[1, 2, 3]])).toBeNull();
    expect(signatureSvg(["<script>"])).toBeNull();
    expect(signatureSvg([[1.5, 2]])).toBeNull();
    expect(signatureSvg([[1001, 2]])).toBeNull();
    expect(signatureSvg([[1, 301]])).toBeNull();
    expect(signatureSvg([[-1, 2]])).toBeNull();
    expect(signatureSvg(Array.from({ length: 61 }, () => [1, 1]))).toBeNull();
    expect(signatureSvg(Array.from({ length: 2 }, () => Array.from({ length: 4002 }, () => 1)))).toBeNull();
  });
});

describe("signer name (FR-QT-10)", () => {
  it("needs a real name of at most 120 characters", () => {
    expect(validateSignerName("  Amaka   Obi ")).toBeNull();
    expect(validateSignerName("Ọlá")).toBeNull();
    expect(validateSignerName(" x ")).toBe("Type your full name");
    expect(validateSignerName("12")).toBe("Type your full name");
    expect(validateSignerName("a".repeat(121))).toBe("Use 120 characters or fewer");
  });
});
