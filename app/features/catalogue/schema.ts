import { z } from "zod";
import { parseMoneyToCents, parseQuantityToMilli } from "~/domain/money";
import { HUES } from "~/styles/tokens";
import { percentToBp } from "../settings/schema";

export const UNITS = ["each", "hour", "sq ft", "linear ft", "yard", "roll", "set", "job"] as const;
export const ITEM_TYPES = ["service", "product", "fee", "allowance"] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer`)
    .transform((v) => (v === "" ? null : v));

const money = (label: string, required: boolean) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") {
        if (required) ctx.addIssue({ code: "custom", message: `Enter the ${label.toLowerCase()}` });
        return null;
      }
      const cents = parseMoneyToCents(v);
      if (cents === null || cents < 0) {
        ctx.addIssue({ code: "custom", message: `${label} must be an amount like 42.75` });
        return z.NEVER;
      }
      return cents;
    });

/** FR-CAT-01…06. The sell price is the source of truth; markup is derived from it and the cost. */
export const itemSchema = z.object({
  type: z.enum(ITEM_TYPES),
  name: z.string().trim().min(1, "Name the item").max(120),
  description: optionalText(2000),
  unit: z.enum(UNITS),
  priceCents: money("Price", true).pipe(z.number()),
  costCents: money("Cost", false),
  supplier: optionalText(120),
  sku: optionalText(60),
  // Checkbox group: one `taxIds` entry per checked tax rate.
  taxIds: z.array(z.string()).default([]),
});

export const markupInputSchema = percentToBp("Markup", 1000);

export const templateSchema = z.object({
  name: z.string().trim().min(1, "Name the template, e.g. Primary bedroom refresh").max(80),
  color: z.enum(HUES),
  // "itemId:qty" pairs in order.
  lines: z
    .array(z.string())
    .default([])
    .transform((pairs, ctx) =>
      pairs.map((pair, position) => {
        const [itemId, qty] = pair.split(":");
        const qtyMilli = parseQuantityToMilli(qty ?? "1");
        if (!itemId || qtyMilli === null || qtyMilli <= 0) {
          ctx.addIssue({ code: "custom", message: "Each line needs an item and a quantity above 0" });
          return { itemId: itemId ?? "", qtyMilli: 1000, position };
        }
        return { itemId, qtyMilli, position };
      }),
    ),
});
