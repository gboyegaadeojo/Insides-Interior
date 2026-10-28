import { describe, expect, it } from "vitest";
import { computeContent, depositFrom } from "~/domain/document";
import { isEmptyRichText, richTextToPlain, sanitizeRichText } from "~/lib/rich-text";

const RATES = [
  { id: "gst", name: "GST", rateBp: 500 },
  { id: "pst", name: "PST", rateBp: 700 },
];

const F1 = {
  taxRates: RATES,
  sections: [
    {
      id: "s1",
      title: "Living room",
      lines: [
        {
          id: "a",
          description: "Design consultation",
          qtyMilli: 3000,
          unit: "hour",
          unitPriceCents: 9500,
          taxRateIds: ["gst", "pst"],
        },
        {
          id: "b",
          description: "Drapery fabric",
          qtyMilli: 4500,
          unit: "yard",
          unitPriceCents: 4275,
          taxRateIds: ["gst", "pst"],
        },
      ],
    },
  ],
};

describe("computeContent", () => {
  it("totals F1 across sections to $534.67", () => {
    const t = computeContent(F1);
    expect(t.computed.totalCents).toBe(53467);
    expect(t.byLine.get("b")!.amountCents).toBe(19238);
    expect(t.hasOptions).toBe(false);
    expect(t.baseTotalCents).toBe(53467);
  });

  it("reports the base total without options and the selection with them (FR-QT-03)", () => {
    const withOption = {
      ...F1,
      sections: [
        ...F1.sections,
        {
          id: "s2",
          title: "Options",
          lines: [
            {
              id: "o",
              description: "Blackout lining",
              qtyMilli: 1000,
              unit: "each",
              unitPriceCents: 10000,
              taxRateIds: ["gst"],
              optional: true,
              selected: true,
            },
          ],
        },
      ],
    };
    const t = computeContent(withOption);
    expect(t.hasOptions).toBe(true);
    expect(t.baseTotalCents).toBe(53467);
    expect(t.computed.totalCents).toBe(53467 + 10500);
  });

  it("works out deposit and balance (FR-QT-05)", () => {
    const t = computeContent(F1, depositFrom("percent", 5000));
    expect(t.depositCents).toBe(26734);
    expect(t.balanceCents).toBe(26733);
    expect(depositFrom(null, 5)).toBeUndefined();
    expect(depositFrom("amount", 1000)).toEqual({ type: "amount", cents: 1000 });
  });
});

describe("rich text sanitiser (SPEC 11.1)", () => {
  it("keeps bold, bullets and line breaks", () => {
    expect(sanitizeRichText("<p>Lined <strong>linen</strong></p><ul><li>Pinch pleat</li></ul>")).toBe(
      "<p>Lined <strong>linen</strong></p><ul><li>Pinch pleat</li></ul>",
    );
    expect(sanitizeRichText("<b>x</b><br/>")).toBe("<strong>x</strong><br>");
  });

  it("drops scripts, attributes, links and unknown tags", () => {
    expect(
      sanitizeRichText('<p onclick="x()">Hi<script>alert(1)</script><img src=x onerror=alert(1)></p>'),
    ).toBe("<p>Hi</p>");
    expect(sanitizeRichText('<a href="javascript:x">link</a><strong style="color:red">b</strong>')).toBe(
      "link<strong>b</strong>",
    );
    expect(sanitizeRichText("<style>p{}</style><!-- c --><em>e</em>")).toBe("e");
  });

  it("escapes stray brackets", () => {
    expect(sanitizeRichText("a < b <p")).toBe("a &lt; b &lt;p");
  });

  it("converts to plain text", () => {
    expect(
      richTextToPlain("<p>Lined &amp; <strong>pleated</strong></p><ul><li>One</li><li>Two</li></ul>"),
    ).toBe("Lined & pleated\n• One\n• Two");
    expect(isEmptyRichText("<p></p>")).toBe(true);
    expect(isEmptyRichText(undefined)).toBe(true);
    expect(isEmptyRichText("<p>x</p>")).toBe(false);
  });
});
