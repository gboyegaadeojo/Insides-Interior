// Expense categories and paging, shared by the screen (browser) and the
// service (server). Kept apart from service.ts so the browser bundle never
// pulls in server code.

import type { ToneName } from "~/components/ui/hue";

export const EXPENSE_CATEGORIES = [
  "materials",
  "fabric",
  "furniture",
  "subcontractor",
  "transport",
  "tools",
  "office",
  "fees",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** Colourful category chips (DS-COL-04); the label always carries the meaning. */
export const EXPENSE_CATEGORY: Record<ExpenseCategory, { label: string; tone: ToneName }> = {
  materials: { label: "Materials", tone: "terracotta" },
  fabric: { label: "Fabric", tone: "plum" },
  furniture: { label: "Furniture", tone: "saffron" },
  subcontractor: { label: "Subcontractor", tone: "indigo" },
  transport: { label: "Transport and fuel", tone: "ocean" },
  tools: { label: "Tools and equipment", tone: "sage" },
  office: { label: "Office and admin", tone: "teal" },
  fees: { label: "Bank and other fees", tone: "roseclay" },
  other: { label: "Other", tone: "slate" },
};

export function categoryOf(value: string) {
  return EXPENSE_CATEGORY[value as ExpenseCategory] ?? EXPENSE_CATEGORY.other;
}

export const EXPENSE_PAGE_SIZE = 50;

/** Receipts: photos from the camera, or a PDF the supplier emailed. */
export const RECEIPT_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf";
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
