import { describe, expect, it } from "vitest";
import { hueForName, initials } from "~/lib/avatar";
import { cn } from "~/lib/utils";
import { HUES } from "~/styles/tokens";

describe("cn", () => {
  it("keeps a colour next to a token font size", () => {
    expect(cn("text-teal-on", "text-label")).toBe("text-teal-on text-label");
  });

  it("still dedupes conflicting sizes, colours, radii and shadows", () => {
    expect(cn("text-label", "text-micro")).toBe("text-micro");
    expect(cn("text-primary", "text-secondary")).toBe("text-secondary");
    expect(cn("rounded-control", "rounded-card")).toBe("rounded-card");
    expect(cn("shadow-card", "shadow-sheet")).toBe("shadow-sheet");
  });
});

describe("avatar", () => {
  it("hashes names to a stable studio hue, ignoring case and spacing", () => {
    expect(hueForName("Amelia Chen")).toBe(hueForName("  amelia chen "));
    expect(HUES).toContain(hueForName("Amelia Chen"));
  });

  it("spreads names across several hues", () => {
    const names = [
      "Amelia Chen",
      "Kwame Mensah",
      "Sophie Tremblay",
      "Raj Patel",
      "Olivia Brown",
      "Ngozi Okafor",
      "Liam Murphy",
      "Emma Wilson",
    ];
    expect(new Set(names.map(hueForName)).size).toBeGreaterThanOrEqual(4);
  });

  it.each([
    ["Amelia Chen", "AC"],
    ["Mary-Jane O'Neil", "MO"],
    ["studio", "ST"],
    ["", "?"],
  ])("initials(%j) = %s", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});
